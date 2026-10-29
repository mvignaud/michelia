// Reçu de paiement aux couleurs de Michel, envoyé au client par e-mail (Postal) en pièce jointe PDF.
// La facture officielle vit dans l'ERP E-KO de GOLDEN PRINT (jamais envoyée au client) : le reçu en
// reprend le numéro. TVA à 20 % sur des prix TTC.
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const POSTAL_API_URL = (Deno.env.get("POSTAL_API_URL") ?? "").replace(/\/+$/, "");
const POSTAL_API_KEY = Deno.env.get("POSTAL_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Michel (MichelIA) <noreply@michel.beer>";
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
  numero: string; // numéro de la facture E-KO
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

  page.drawRectangle({ x: 0, y: 0, width, height, color: C.fond });
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: C.accent });
  page.drawRectangle({ x: 0, y: height - 126, width, height: 6, color: C.ocre });
  page.drawText("MichelIA", { x: m, y: height - 70, size: 30, font: gras, color: C.surAccent });
  page.drawText("Le vieux Gersois qui répond à tout", { x: m, y: height - 95, size: 12, font: italique, color: C.surAccent });

  let y = height - 180;
  page.drawText("Reçu de paiement", { x: m, y, size: 22, font: gras, color: C.texte });
  y -= 26;
  page.drawText(`Facture n° ${r.numero} · ${jour(r.date)}`, { x: m, y, size: 11, font: normal, color: C.gris });
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

// Envoie le reçu ; renvoie false si Postal n'est pas configuré ou refuse (l'appelant journalise).
export async function envoyerRecu(r: Recu): Promise<boolean> {
  if (!POSTAL_API_URL || !POSTAL_API_KEY) return false;
  const nom = r.prenom ? ` ${r.prenom}` : "";
  const texte = [
    `Adishatz${nom} !`,
    `Merci pour ton paiement de ${euros(r.montantTtcCents)}. Ton reçu est en pièce jointe (facture n° ${r.numero}).`,
    "Allez, porte-toi bien.\nMichel",
    SITE_URL,
  ].join("\n\n");
  try {
    const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
      method: "POST",
      headers: { "X-Server-API-Key": POSTAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [r.email],
        from: MAIL_FROM,
        subject: `Ton reçu Michel (n° ${r.numero})`,
        plain_body: texte,
        tag: "recu",
        attachments: [{ name: `recu-michel-${r.numero}.pdf`, content_type: "application/pdf", data: base64(await pdfRecu(r)) }],
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      console.error("Postal refuse le reçu :", response.status, JSON.stringify(result?.data ?? result));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Postal injoignable :", e);
    return false;
  }
}
