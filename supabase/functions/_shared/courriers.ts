// Les e-mails de Michel autour de l'argent : reçu, remboursement, paiement refusé, abonnement MichelIA+
// (bienvenue, renouvellement à venir, résiliation) et prélèvement SEPA (mandat, préavis, rejet).
// Chaque modèle rend un sujet, un texte brut et un HTML aux couleurs de la lettre de Michel.
// Le ton reste celui de Michel, mais les mentions qui comptent (montants, dates, références) sont
// toujours écrites en clair. Envoi par Postal avec envoyerCourrier().

const POSTAL_API_URL = (Deno.env.get("POSTAL_API_URL") ?? "").replace(/\/+$/, "");
const POSTAL_API_KEY = Deno.env.get("POSTAL_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Michel (MichelIA) <noreply@michel.beer>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://michel.beer").replace(/\/+$/, "");

const BRIQUE = "#7A2E1D";
const OCRE = "#D9A441";
const CREME = "#FBF4E8";
const ENCRE = "#2B2420";
const GRIS = "#A39586";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const VENDEUR = "GOLDEN PRINT SAS · 14 route d’Espas, 32370 Manciet · RCS Auch 939 018 024";

export type Courrier = { sujet: string; texte: string; html: string };

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
const jour = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Un bloc du message : un paragraphe, ou un petit tableau « libellé : valeur » pour les chiffres.
type Bloc = string | { lignes: [string, string][] } | { bouton: string; url: string };

function composer(sujet: string, prenom: string | null | undefined, blocs: Bloc[], signature = "Allez, porte-toi bien.\nMichel"): Courrier {
  const salut = `Adishatz${prenom ? ` ${prenom}` : ""} !`;
  const texte = [
    salut,
    ...blocs.map((b) =>
      typeof b === "string" ? b : "lignes" in b ? b.lignes.map(([k, v]) => `${k} : ${v}`).join("\n") : `${b.bouton} : ${b.url}`
    ),
    signature,
    `${SITE_URL}\n${VENDEUR}`,
  ].join("\n\n");

  const corps = blocs.map((b) => {
    if (typeof b === "string") return `<p style="margin:0 0 16px;">${escapeHtml(b).replace(/\n/g, "<br>")}</p>`;
    if ("lignes" in b) {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-top:2px solid ${OCRE};">${
        b.lignes.map(([k, v]) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #EFE4D4;color:#6B5E52;">${escapeHtml(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #EFE4D4;font-weight:bold;">${escapeHtml(v)}</td></tr>`
        ).join("")
      }</table>`;
    }
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:${BRIQUE};border-radius:12px;"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:14px 26px;font-weight:bold;font-size:16px;color:#FFF8EE;text-decoration:none;">${escapeHtml(b.bouton)}</a></td></tr></table>`;
  }).join("\n");

  const [fin, nom] = signature.split("\n");
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(sujet)}</title>
</head>
<body style="margin:0;padding:0;background:${CREME};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREME};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td align="center" style="padding-bottom:18px;">
<img src="${SITE_URL}/email/michel.png" width="72" height="72" alt="Michel" style="display:block;border:3px solid ${OCRE};border-radius:50%;">
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:16px;border-top:5px solid ${OCRE};padding:28px 24px 22px;font-family:${SANS};font-size:16px;line-height:1.6;color:${ENCRE};">
<p style="margin:0 0 12px;font-family:${SERIF};font-size:20px;font-weight:bold;">${escapeHtml(salut)}</p>
${corps}
<p style="margin:8px 0 4px;">${escapeHtml(fin)}</p>
<p style="margin:0;font-family:${SERIF};font-size:20px;font-style:italic;color:${BRIQUE};">${escapeHtml(nom ?? "Michel")}</p>
</td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${GRIS};">
${escapeHtml(VENDEUR)}<br>
<a href="${SITE_URL}" style="color:${GRIS};">michel.beer</a> · <a href="${SITE_URL}/confidentialite.html" style="color:${GRIS};">Confidentialité</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { sujet, texte, html };
}

// --- Paiements ponctuels -----------------------------------------------------------------

export const paiementRecu = (p: { prenom?: string | null; montantCents: number; libelle: string; numero: string; facture: boolean }) =>
  composer(`Ton reçu Michel (n° ${p.numero})`, p.prenom, [
    `Merci pour ton paiement, ça me fait chaud au cœur. Ton reçu est en pièce jointe, range-le au chaud.`,
    { lignes: [[p.libelle, euros(p.montantCents)], [p.facture ? "Facture n°" : "Reçu n°", p.numero]] },
  ]);

export const remboursement = (p: { prenom?: string | null; montantCents: number; libelle: string; numero: string; date: Date }) =>
  composer(`Remboursement de ${euros(p.montantCents)}`, p.prenom, [
    `Je t'ai remboursé, pas d'histoire. L'argent revient sur ta carte d'ici quelques jours, le temps que la banque se réveille.`,
    { lignes: [["Montant remboursé", euros(p.montantCents)], ["Pour", p.libelle], ["Reçu d'origine", p.numero], ["Date", jour(p.date)]] },
    `Si tu ne t'attendais pas à ce remboursement, réponds simplement à ce message.`,
  ]);

export const paiementRefuse = (p: { prenom?: string | null; montantCents: number; libelle: string; urlEspace: string }) =>
  composer(`Ton paiement n'est pas passé`, p.prenom, [
    `Ta banque n'a pas voulu de ton paiement. Ça arrive : carte expirée, plafond atteint, ou le banquier qui fait la sieste. Rien n'a été débité.`,
    { lignes: [["Montant", euros(p.montantCents)], ["Pour", p.libelle]] },
    `Tu peux réessayer ou changer de moyen de paiement depuis ton espace :`,
    { bouton: "Mettre à jour mon paiement", url: p.urlEspace },
  ]);

// --- Abonnement MichelIA+ ---------------------------------------------------------------

export const abonnementBienvenue = (p: {
  prenom?: string | null; formule: string; montantCents: number; periode: "mois" | "an"; prochaineEcheance: Date; moyen: string; urlEspace: string;
}) =>
  composer(`Bienvenue dans MichelIA+`, p.prenom, [
    `Te voilà abonné à MichelIA+. Merci, ça m'aide à garder Michel gratuit pour tout le monde.`,
    { lignes: [["Formule", p.formule], ["Prix", `${euros(p.montantCents)} TTC par ${p.periode}`], ["Prochaine échéance", jour(p.prochaineEcheance)], ["Paiement", p.moyen]] },
    `Tu peux arrêter quand tu veux, depuis ton espace, en deux clics. Pas de lettre recommandée, pas de piège.`,
    { bouton: "Mon espace MichelIA+", url: p.urlEspace },
  ]);

// Rappel avant une reconduction tacite (formule annuelle) : à envoyer un à trois mois avant l'échéance.
export const abonnementRenouvellement = (p: {
  prenom?: string | null; formule: string; montantCents: number; echeance: Date; dateLimite: Date; urlEspace: string;
}) =>
  composer(`Ton abonnement MichelIA+ se renouvelle le ${jour(p.echeance)}`, p.prenom, [
    `Petit rappel, comme la loi le veut et comme je l'aime : ton abonnement se renouvelle tout seul bientôt.`,
    { lignes: [["Formule", p.formule], ["Renouvellement", jour(p.echeance)], ["Montant", `${euros(p.montantCents)} TTC`], ["Pour arrêter, avant le", jour(p.dateLimite)]] },
    `Si tu veux continuer, tu n'as rien à faire. Sinon, tu peux résilier depuis ton espace avant la date indiquée, sans frais.`,
    { bouton: "Gérer mon abonnement", url: p.urlEspace },
  ]);

export const abonnementAnnule = (p: { prenom?: string | null; formule: string; finAcces: Date; urlEspace: string }) =>
  composer(`Ton abonnement MichelIA+ est résilié`, p.prenom, [
    `C'est noté, ton abonnement est résilié. Je ne te prélèverai plus rien. Tu gardes tes avantages jusqu'au bout de ce que tu as déjà payé, et après on reste copains : Michel gratuit, lui, ne bouge pas.`,
    { lignes: [["Formule", p.formule], ["Avantages jusqu'au", jour(p.finAcces)]] },
    `Si tu changes d'avis, tu peux te réabonner quand tu veux.`,
    { bouton: "Mon espace", url: p.urlEspace },
  ]);

// --- Prélèvement SEPA -------------------------------------------------------------------

export type Creancier = { nom: string; ics: string };

export const mandatSigne = (p: { prenom?: string | null; rum: string; iban4: string; creancier: Creancier; date: Date }) =>
  composer(`Ton mandat de prélèvement est enregistré`, p.prenom, [
    `Ton mandat de prélèvement SEPA est bien signé et enregistré. Garde ce message, il te sert de preuve.`,
    { lignes: [["Référence du mandat (RUM)", p.rum], ["Créancier", p.creancier.nom], ["Identifiant créancier (ICS)", p.creancier.ics], ["Compte", `IBAN se terminant par ${p.iban4}`], ["Signé le", jour(p.date)]] },
    `Avant chaque prélèvement, je te préviens du montant et de la date. Tu peux contester un prélèvement auprès de ta banque dans les 8 semaines qui suivent le débit.`,
  ]);

// Préavis obligatoire avant chaque prélèvement (au moins 14 jours avant, sauf délai plus court convenu).
export const prelevementAVenir = (p: {
  prenom?: string | null; montantCents: number; date: Date; libelle: string; numero: string; rum: string; creancier: Creancier;
}) =>
  composer(`Prélèvement de ${euros(p.montantCents)} le ${jour(p.date)}`, p.prenom, [
    `Je te préviens, comme promis : je vais prélever ton abonnement sur ton compte.`,
    { lignes: [["Montant", `${euros(p.montantCents)} TTC`], ["Date du prélèvement", jour(p.date)], ["Pour", p.libelle], ["Facture n°", p.numero], ["Mandat (RUM)", p.rum], ["Créancier (ICS)", `${p.creancier.nom}, ${p.creancier.ics}`]] },
    `Rien à faire de ton côté, il suffit que le compte soit approvisionné.`,
  ]);

export const prelevementRejete = (p: { prenom?: string | null; montantCents: number; date: Date; motif: string; urlEspace: string }) =>
  composer(`Ton prélèvement a été rejeté`, p.prenom, [
    `Ta banque a rejeté le prélèvement de ton abonnement. Ça arrive, pas de panique, mais il faut qu'on règle ça.`,
    { lignes: [["Montant", euros(p.montantCents)], ["Date prévue", jour(p.date)], ["Motif de la banque", p.motif]] },
    `Tu peux payer par carte ou mettre à jour ton RIB depuis ton espace. Sans nouvelle de ta part, ton abonnement sera mis en pause, sans autre frais de mon côté.`,
    { bouton: "Régler mon abonnement", url: p.urlEspace },
  ]);

// --- Envoi ------------------------------------------------------------------------------

export type PieceJointe = { nom: string; type: string; base64: string };

// Envoie un courrier ; false si Postal n'est pas configuré ou refuse (l'appelant journalise).
export async function envoyerCourrier(to: string, c: Courrier, tag: string, pieces: PieceJointe[] = []): Promise<boolean> {
  if (!POSTAL_API_URL || !POSTAL_API_KEY) return false;
  try {
    const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
      method: "POST",
      headers: { "X-Server-API-Key": POSTAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [to],
        from: MAIL_FROM,
        subject: c.sujet,
        plain_body: c.texte,
        html_body: c.html,
        tag,
        attachments: pieces.map((p) => ({ name: p.nom, content_type: p.type, data: p.base64 })),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      console.error("Postal refuse le courrier", tag, response.status, JSON.stringify(result?.data ?? result));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Postal injoignable :", e);
    return false;
  }
}
