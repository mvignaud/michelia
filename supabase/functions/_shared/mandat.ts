// Mandat de prélèvement SEPA signé chez Michel (MichelIA+ sur le site) : l'IBAN est tapé dans notre
// formulaire, Michel envoie un code par SMS (Twilio), et la personne signe en le recopiant. Le mandat
// signé (PDF) part chez Stancer avec l'IBAN, est gardé dans le stockage privé « mandats » et envoyé à
// la personne par e-mail. L'IBAN complet ne va jamais en base ni dans les journaux : seulement ses
// 4 derniers caractères, et une empreinte le temps de la signature. Voir docs/MICHELIA-PLUS.md.
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { CREANCIER } from "./courriers.ts";

// Adresse du créancier, imprimée sur le mandat (mention obligatoire).
export const CREANCIER_ADRESSE = "14 route d’Espas, 32370 Manciet, France";

// IBAN sans espaces, en capitales, avec sa clé de contrôle (ISO 13616, modulo 97). Zone SEPA seulement.
const PAYS_SEPA = new Set([
  "AD", "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GI", "GR", "HR", "HU", "IE", "IS",
  "IT", "LI", "LT", "LU", "LV", "MC", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "SM", "VA",
]);

export function cleanIban(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const iban = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) || !PAYS_SEPA.has(iban.slice(0, 2))) return null;
  const chiffres = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let reste = 0;
  for (const c of chiffres) reste = (reste * 10 + Number(c)) % 97;
  return reste === 1 ? iban : null;
}

// Titulaire du compte : lettres, espaces, tiret, apostrophe et point, 3 à 64 caractères.
export function cleanTitulaire(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nom = raw.replace(/[^\p{L}\p{M} '’.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 64).trim();
  return nom.length >= 3 ? nom : null;
}

// Numéro de mobile au format international (E.164) ; un numéro français 06/07 est complété en +33.
export function cleanMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let tel = raw.replace(/[\s.()-]/g, "");
  if (/^0[67]\d{8}$/.test(tel)) tel = `+33${tel.slice(1)}`;
  if (tel.startsWith("00")) tel = `+${tel.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(tel) ? tel : null;
}

// Référence unique du mandat (RUM) : 35 caractères au plus, lettres, chiffres et tirets.
export function nouvelleRum(abonnementId: number): string {
  const hasard = crypto.getRandomValues(new Uint8Array(5)).reduce((t, b) => t + b.toString(16).padStart(2, "0"), "").toUpperCase();
  return `MICHEL-${abonnementId}-${hasard}`.slice(0, 35);
}

// Code à 6 chiffres, tiré sans biais.
export function nouveauCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function empreinte(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("\u0000"));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparaison sans fuite de temps (deux empreintes hexadécimales).
export function memeEmpreinte(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM") ?? "";
export const smsConfigure = () => !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);

// Envoie un SMS par Twilio ; false si Twilio refuse (l'appelant le dit à la personne).
export async function envoyerSms(to: string, texte: string): Promise<boolean> {
  if (!smsConfigure()) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}` },
    // TWILIO_FROM : un service de messagerie Twilio (MG…), un numéro (+33…) ou un expéditeur (« Michel »).
    body: new URLSearchParams({ To: to, Body: texte, ...(/^MG[0-9a-f]{32}$/.test(TWILIO_FROM) ? { MessagingServiceSid: TWILIO_FROM } : { From: TWILIO_FROM }) }),
  }).catch(() => null);
  if (!res?.ok) {
    const data = await res?.json().catch(() => null);
    console.error("SMS : Twilio a refusé", res?.status ?? "réseau", data?.code ?? "", String(data?.message ?? "").replace(/\+?\d{6,}/g, "…").slice(0, 160));
    return false;
  }
  return true;
}

export type Mandat = {
  rum: string;
  titulaire: string;
  iban: string;
  email: string;
  libelle: string; // ex. « MichelIA+ au mois, 3,99 € par mois »
  signeLe: Date;
  telephoneMasque: string; // ex. « +33 •• •• •• 12 »
  ip: string;
};

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { texte: hex("#2B2420"), gris: hex("#7D6E62"), accent: hex("#7A2E1D"), ocre: hex("#D9A441") };
const heure = (d: Date) => d.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Paris" });

// Le mandat SEPA (formulaire normalisé du prélèvement SEPA CORE, récurrent), signé électroniquement.
export async function pdfMandat(m: Mandat): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Mandat de prélèvement SEPA ${m.rum}`);
  doc.setAuthor(CREANCIER.nom);
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const connus = new Set(normal.getCharacterSet());
  const latin = (t: string) =>
    [...t].map((ch) => {
      if (connus.has(ch.codePointAt(0)!)) return ch;
      const nu = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return [...nu].every((c) => connus.has(c.codePointAt(0)!)) && nu ? nu : "?";
    }).join("");
  const marge = 56;
  let y = height - 70;
  const texte = (t: string, size = 10, font = normal, color = C.texte) => {
    // Coupe en lignes qui tiennent dans la page.
    const mots = latin(t).split(" ");
    let ligne = "";
    for (const mot of mots) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (font.widthOfTextAtSize(essai, size) > width - 2 * marge) {
        page.drawText(ligne, { x: marge, y, size, font, color });
        y -= size + 5;
        ligne = mot;
      } else ligne = essai;
    }
    if (ligne) page.drawText(ligne, { x: marge, y, size, font, color });
    y -= size + 9;
  };
  const champ = (label: string, valeur: string) => {
    page.drawText(latin(label), { x: marge, y, size: 10, font: normal, color: C.gris });
    page.drawText(latin(valeur), { x: marge + 170, y, size: 10, font: gras, color: C.texte });
    y -= 18;
  };

  page.drawText("Mandat de prélèvement SEPA", { x: marge, y, size: 20, font: gras, color: C.accent });
  y -= 26;
  page.drawLine({ start: { x: marge, y: y + 10 }, end: { x: width - marge, y: y + 10 }, thickness: 1.5, color: C.ocre });
  y -= 10;
  champ("Référence unique (RUM)", m.rum);
  champ("Type de paiement", "Récurrent");
  y -= 6;
  texte(
    `En signant ce formulaire de mandat, vous autorisez ${CREANCIER.nom} à envoyer des instructions à votre banque pour débiter votre compte, et votre banque à débiter votre compte conformément aux instructions de ${CREANCIER.nom}. Vous bénéficiez du droit d'être remboursé par votre banque selon les conditions décrites dans la convention que vous avez passée avec elle. Une demande de remboursement doit être présentée dans les 8 semaines suivant la date de débit de votre compte pour un prélèvement autorisé.`,
  );
  y -= 4;
  page.drawText("Créancier", { x: marge, y, size: 12, font: gras, color: C.accent });
  y -= 18;
  champ("Nom", CREANCIER.nom);
  champ("Identifiant créancier (ICS)", CREANCIER.ics);
  champ("Adresse", CREANCIER_ADRESSE);
  y -= 6;
  page.drawText("Débiteur", { x: marge, y, size: 12, font: gras, color: C.accent });
  y -= 18;
  champ("Titulaire du compte", m.titulaire);
  champ("IBAN", m.iban.replace(/(.{4})/g, "$1 ").trim());
  champ("E-mail", m.email);
  y -= 6;
  page.drawText("Objet", { x: marge, y, size: 12, font: gras, color: C.accent });
  y -= 18;
  texte(m.libelle);
  y -= 6;
  page.drawText("Signature électronique", { x: marge, y, size: 12, font: gras, color: C.accent });
  y -= 18;
  champ("Signé le", heure(m.signeLe));
  champ("Par", `code à usage unique envoyé par SMS au ${m.telephoneMasque}`);
  champ("Adresse IP", m.ip || "inconnue");
  y -= 6;
  texte("Le débiteur a recopié sur michel.beer le code reçu par SMS, ce qui vaut signature du présent mandat.", 9, normal, C.gris);

  page.drawText(latin(`${CREANCIER.nom} · ${CREANCIER_ADRESSE} · RCS Auch 939 018 024`), { x: marge, y: 60, size: 8, font: normal, color: C.gris });
  return await doc.save();
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const masquerTelephone = (tel: string) => `${tel.slice(0, 3)} •• •• •• ${tel.slice(-2)}`;
