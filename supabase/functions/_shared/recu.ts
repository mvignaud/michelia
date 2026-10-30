// Reçu de paiement aux couleurs de Michel, envoyé au client par e-mail (courriers.ts) en pièce jointe PDF.
// La facture officielle vit dans l'ERP E-KO de GOLDEN PRINT (jamais envoyée au client) : le reçu en
// reprend le numéro quand elle existe déjà. TVA à 20 % sur des prix TTC.
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { envoyerCourrier, paiementRecu } from "./courriers.ts";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/+$/, "");

export const TAUX_TVA = 0.2;

// Mentions du vendeur, imprimées en pied de reçu.
const VENDEUR = [
  "GOLDEN PRINT SAS · 14 route d’Espas, 32370 Manciet",
  "RCS Auch 939 018 024 · TVA intracommunautaire FR66939018024",
];

// Couleurs de l'appli (app/src/theme.ts).
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { fond: hex("#FBF4E8"), texte: hex("#2B2420"), gris: hex("#7D6E62"), accent: hex("#7A2E1D"), ocre: hex("#D9A441"), surAccent: hex("#FFF8EE") };

export type Recu = {
  numero: string; // numéro de reçu (R2026-000123), aussi numéro de commande chez le prestataire
  facture: string | null; // numéro de la facture E-KO, quand elle existe déjà
  date: Date;
  email: string;
  prenom?: string | null;
  libelle: string; // ex. « Pourboire : un café pour Michel »
  montantTtcCents: number;
  moyen: string; // ex. « Carte bancaire »
};

export function decompose(ttcCents: number) {
  const ht = Math.round(ttcCents / (1 + TAUX_TVA));
  return { ht, tva: ttcCents - ht, ttc: ttcCents };
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
const jour = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

export async function pdfRecu(r: Recu): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Reçu ${r.numero}`);
  doc.setAuthor("GOLDEN PRINT SAS");
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const italique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const m = 56;

  // Les polices standard du PDF ne connaissent que l'alphabet latin (WinAnsi) : une lettre hors de
  // cet alphabet (prénom en cyrillique, émoji…) perd son accent ou devient « ? » (un tel prénom est omis),
  // au lieu de faire échouer tout le reçu.
  const connus = new Set(normal.getCharacterSet());
  const latin = (t: string) =>
    [...t].map((ch) => {
      if (connus.has(ch.codePointAt(0)!)) return ch;
      const nu = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      return [...nu].every((c) => connus.has(c.codePointAt(0)!)) && nu ? nu : "?";
    }).join("");
  r = { ...r, numero: latin(r.numero), facture: r.facture ? latin(r.facture) : null, email: latin(r.email), prenom: r.prenom && !latin(r.prenom).includes("?") ? latin(r.prenom) : null, libelle: latin(r.libelle) };

  page.drawRectangle({ x: 0, y: 0, width, height, color: C.fond });
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: C.accent });
  page.drawRectangle({ x: 0, y: height - 126, width, height: 6, color: C.ocre });
  // Logo de Michel servi par le site (app/public/email/logo-recu.png) ; à défaut, son nom en toutes lettres.
  // 3 secondes au plus, téléchargement compris : un site lent ne retarde pas les reçus.
  const logo = await fetch(`${SITE_URL}/email/logo-recu.png`, { signal: AbortSignal.timeout(3000) })
    .then(async (r) => r.ok ? await doc.embedPng(new Uint8Array(await r.arrayBuffer())) : null)
    .catch(() => null);
  if (logo) {
    const logoH = 72;
    page.drawImage(logo, { x: m - 8, y: height - 98, width: logoH * logo.width / logo.height, height: logoH });
  } else {
    page.drawText("MichelIA", { x: m, y: height - 72, size: 30, font: gras, color: C.surAccent });
  }
  const devise = "Le vieux Gersois qui répond à tout";
  page.drawText(devise, { x: width - m - italique.widthOfTextAtSize(devise, 11), y: height - 68, size: 11, font: italique, color: C.surAccent });

  let y = height - 180;
  page.drawText("Reçu de paiement", { x: m, y, size: 22, font: gras, color: C.texte });
  y -= 26;
  page.drawText(`Reçu n° ${r.numero}${r.facture ? ` · Facture n° ${r.facture}` : ""} · ${jour(r.date)}`, { x: m, y, size: 11, font: normal, color: C.gris });
  y -= 40;
  const bonjour = r.prenom ? `Merci ${r.prenom} !` : "Merci !";
  page.drawText(bonjour, { x: m, y, size: 14, font: gras, color: C.accent });
  y -= 20;
  page.drawText("Michel a bien reçu ton paiement. Voilà ton reçu, range-le au chaud.", { x: m, y, size: 11, font: normal, color: C.texte });

  // Tableau du montant.
  y -= 50;
  const droite = width - m;
  const ligne = (label: string, valeur: string, font = normal, size = 11) => {
    page.drawText(label, { x: m, y, size, font, color: C.texte });
    page.drawText(valeur, { x: droite - font.widthOfTextAtSize(valeur, size), y, size, font, color: C.texte });
    y -= size + 12;
  };
  page.drawLine({ start: { x: m, y: y + 18 }, end: { x: droite, y: y + 18 }, thickness: 1, color: C.ocre });
  const { ht, tva, ttc } = decompose(r.montantTtcCents);
  ligne(r.libelle, euros(ttc));
  y -= 6;
  ligne("Montant hors taxes", euros(ht));
  ligne(`TVA ${Math.round(TAUX_TVA * 100)} %`, euros(tva));
  page.drawLine({ start: { x: m, y: y + 14 }, end: { x: droite, y: y + 14 }, thickness: 1, color: C.ocre });
  y -= 4;
  ligne("Total payé TTC", euros(ttc), gras, 13);
  ligne("Moyen de paiement", r.moyen);
  ligne("Payé par", r.email);

  y = 90;
  for (const l of VENDEUR) {
    page.drawText(l, { x: m, y, size: 9, font: normal, color: C.gris });
    y -= 13;
  }
  page.drawText(SITE_URL.replace(/^https?:\/\//, ""), { x: m, y, size: 9, font: normal, color: C.accent });

  return await doc.save();
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Envoie le reçu en pièce jointe ; false si Postal n'est pas configuré ou refuse (l'appelant journalise).
export async function envoyerRecu(r: Recu): Promise<boolean> {
  const courrier = paiementRecu({ prenom: r.prenom, montantCents: r.montantTtcCents, libelle: r.libelle, numero: r.numero, facture: r.facture });
  return envoyerCourrier(r.email, courrier, "recu", [
    { nom: `recu-michel-${r.numero}.pdf`, type: "application/pdf", base64: base64(await pdfRecu(r)) },
  ]);
}
