// Les e-mails d'alerte pour Mathieu, aux couleurs des courriers de Michel : un modèle par genre d'alerte
// (voir la migration 20261030160000_alertes.sql) et le récapitulatif quand il en tombe beaucoup d'un coup.
import { type Bloc, composer, type Courrier, euros, jour } from "./courriers.ts";

export type Alerte = { id: number; genre: string; donnees: Record<string, unknown>; created_at: string };

// Les boutons ouvrent directement la bonne table dans le Table Editor de Supabase : l'adresse veut le
// numéro interne de la table (son oid), lu avec « select oid, relname from pg_class where relname = '…' ».
// Il ne change que si la table est supprimée puis recréée : dans ce cas, relire l'oid et le mettre ici.
const PROJET = "https://supabase.com/dashboard/project/nuulykhqaeecqerfwdsn";
const TABLE = { doleances: 18443, notes_reponses: 18468, pourboires: 18401, abonnements: 18610 };
const table = (nom: keyof typeof TABLE) => `${PROJET}/editor/${TABLE[nom]}?schema=public`;
const COMPTES = `${PROJET}/auth/users`;
const SIGNATURE = "Je retourne au comptoir.\nMichel";

// Ce qu'une alerte devient dans un e-mail : un sujet, des paragraphes et le tableau des chiffres.
type Fiche = { sujet: string; blocs: Bloc[]; repondreA?: string };

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? jour(new Date(v)) : "?");
const heure = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const ou = (v: unknown) => txt(v) ?? "pas dit";
export const estEmail = (v: unknown) => typeof v === "string" && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v.trim());
const ligne = (k: string, v: string | null): [string, string][] => (v ? [[k, v]] : []);

const CATEGORIES: Record<string, string> = { idee: "💡 Une idée", bug: "🐞 Un bug", autre: "📝 Une râlerie" };
const SOURCES: Record<string, string> = { web: "le site", apple: "l'App Store", google: "Google Play" };
const CANAUX: Record<string, string> = { web: "le site", ios: "l'appli iPhone", android: "l'appli Android" };
const FOURNISSEURS: Record<string, string> = { email: "e-mail", google: "Google", facebook: "Facebook", apple: "Apple", phone: "téléphone" };

function prixFormule(d: Record<string, unknown>, cle = "prix_cents") {
  return `${euros(num(d[cle]))} par ${d.formule === "an" ? "an" : "mois"}`;
}

function paiement(d: Record<string, unknown>) {
  const source = SOURCES[String(d.source)] ?? String(d.source);
  return d.source === "web" ? `${source}, ${d.moyen === "sepa" ? "prélèvement SEPA" : "carte"}` : source;
}

function fiche(a: Alerte): Fiche {
  const d = a.donnees ?? {};
  const prenom = txt(d.prenom);
  switch (a.genre) {
    case "doleance": {
      const cat = CATEGORIES[String(d.categorie)] ?? CATEGORIES.autre;
      const contact = txt(d.contact);
      return {
        sujet: `${cat} dans le cahier de doléances`,
        blocs: [
          `${cat.slice(cat.indexOf(" ") + 1)} vient d'atterrir dans le cahier. Je te recopie ça tel quel :`,
          `« ${txt(d.texte) ?? ""} »`,
          { lignes: [["Genre", cat], ["Contact", contact ?? "aucun"], ["Déposé par", d.compte ? "un compte" : "un visiteur"], ["N°", String(d.id ?? "?")]] },
          estEmail(contact) ? "Réponds à ce message, ça part directement chez la personne." : "Pas d'e-mail laissé, donc pas de réponse possible.",
          { bouton: "Ouvrir le cahier", url: table("doleances") },
        ],
        repondreA: estEmail(contact) ? contact!.trim() : undefined,
      };
    }
    case "note_basse":
      return {
        sujet: `${"★".repeat(num(d.note))}${"☆".repeat(5 - num(d.note))} Une réponse de Michel mal notée`,
        blocs: [
          `Quelqu'un n'a pas aimé une de mes réponses. Ça pique, mais c'est comme ça qu'on progresse.`,
          { lignes: [["Note", `${num(d.note)} sur 5`], ...ligne("Mode", txt(d.mode))] },
          ...(txt(d.question) ? [`La question : « ${txt(d.question)} »`] : []),
          `Ma réponse : « ${txt(d.reponse) ?? ""} »`,
          { bouton: "Voir les notes", url: table("notes_reponses") },
        ],
      };
    case "inscription": {
      const nom = [txt(d.prenom), txt(d.nom)].filter(Boolean).join(" ");
      return {
        sujet: `👋 Nouveau compte${nom ? ` : ${nom}` : ""}`,
        blocs: [
          `Une nouvelle tête vient de s'inscrire chez Michel. On est ${num(d.total)} au comptoir maintenant.`,
          { lignes: [["Nom", nom || "pas dit"], ["E-mail", ou(d.email)], ["Inscrit avec", FOURNISSEURS[String(d.fournisseur)] ?? ou(d.fournisseur)], ...ligne("Né en", d.annee ? String(d.annee) : null)] },
          { bouton: "Voir les comptes", url: COMPTES },
        ],
      };
    }
    case "depart":
      return {
        sujet: `🚪 Un compte a été supprimé`,
        blocs: [
          `${prenom ?? "Quelqu'un"} a supprimé son compte. Pas de rancune, la porte reste ouverte. On est ${num(d.total)} au comptoir.`,
          { lignes: [["Prénom", prenom ?? "pas dit"], ["Inscrit le", date(d.inscrit_le)]] },
          { bouton: "Voir les comptes", url: COMPTES },
        ],
      };
    case "pourboire":
      return {
        sujet: `☕ Pourboire de ${euros(num(d.montant_cents))}${prenom ? ` de ${prenom}` : ""}`,
        blocs: [
          `${prenom ?? "Quelqu'un"} m'a laissé un pourboire. Ça, ça me fait plaisir.`,
          { lignes: [["Montant", euros(num(d.montant_cents))], ["Palier", ou(d.palier)], ["Par", CANAUX[String(d.canal)] ?? ou(d.canal)], ["Ce mois-ci", `${num(d.mois_nombre)} pourboires, ${euros(num(d.mois_cents))}`]] },
          { bouton: "Voir les pourboires", url: table("pourboires") },
        ],
      };
    case "remboursement":
      return {
        sujet: `↩️ Remboursement de ${euros(num(d.rembourse_cents))}`,
        blocs: [
          `Un pourboire vient d'être remboursé. Le reçu et l'avoir partent tout seuls chez la personne.`,
          { lignes: [["Remboursé", euros(num(d.rembourse_cents))], ["Sur un pourboire de", euros(num(d.montant_cents))], ...ligne("Reçu d'origine", txt(d.numero_recu)), ...ligne("Prénom", prenom)] },
          { bouton: "Voir les pourboires", url: table("pourboires") },
        ],
      };
    case "abonnement":
      return {
        sujet: `⭐ Nouvel abonné MichelIA+ (${prixFormule(d)})`,
        blocs: [
          `${prenom ?? "Quelqu'un"} vient de prendre MichelIA+. Ça fait ${num(d.actifs)} abonnés en tout.`,
          { lignes: [["Formule", prixFormule(d)], ["Payé par", paiement(d)], ["Jusqu'au", date(d.fin_periode)], ...ligne("E-mail", txt(d.email))] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    case "renouvellement":
      return {
        sujet: `🔁 MichelIA+ renouvelé (${euros(num(d.montant_cents))})`,
        blocs: [
          `${prenom ?? "Un abonné"} reste avec nous pour une période de plus.`,
          { lignes: [["Montant", euros(num(d.montant_cents))], ["Formule", d.formule === "an" ? "à l'année" : "au mois"], ["Payé par", paiement(d)], ["Jusqu'au", date(d.periode_fin)]] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    case "impaye":
      return {
        sujet: `⚠️ Échéance MichelIA+ impayée`,
        blocs: [
          `Une échéance de ${prenom ?? "quelqu'un"} n'est pas passée. ${d.source === "web" ? "Je réessaie tout seul, et la personne est prévenue." : "La boutique réessaie de son côté."}`,
          { lignes: [["Formule", prixFormule(d)], ["Payé par", paiement(d)], ["Échecs d'affilée", String(num(d.echecs))], ...ligne("E-mail", txt(d.email))] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    case "reprise":
      return {
        sujet: `✅ MichelIA+ reparti pour ${prenom ?? "un abonné"}`,
        blocs: [
          `Bonne nouvelle : l'abonnement de ${prenom ?? "quelqu'un"} est de nouveau actif.`,
          { lignes: [["Formule", prixFormule(d)], ["Payé par", paiement(d)], ["Jusqu'au", date(d.fin_periode)]] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    case "resiliation":
      return {
        sujet: `👋 Résiliation MichelIA+`,
        blocs: [
          `${prenom ?? "Quelqu'un"} a résilié MichelIA+. Les avantages courent jusqu'au bout de ce qui est payé. Il reste ${num(d.actifs)} abonnés, résiliés en cours compris.`,
          { lignes: [["Formule", prixFormule(d)], ["Payé par", paiement(d)], ["Avantages jusqu'au", date(d.fin_periode)], ...ligne("E-mail", txt(d.email))] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    case "fin_abonnement":
      return {
        sujet: `🍂 Fin d'un abonnement MichelIA+`,
        blocs: [
          `L'abonnement de ${prenom ?? "quelqu'un"} est terminé pour de bon.`,
          { lignes: [["Formule", prixFormule(d)], ["Payé par", paiement(d)], ["Échecs d'affilée", String(num(d.echecs))]] },
          { bouton: "Voir les abonnements", url: table("abonnements") },
        ],
      };
    default:
      return { sujet: `Alerte ${a.genre}`, blocs: [JSON.stringify(d)] };
  }
}

export function courrier(a: Alerte): { c: Courrier; repondreA?: string } {
  const f = fiche(a);
  return { c: composer(f.sujet, "Mathieu", [...f.blocs, `Arrivé le ${heure(a.created_at)}.`], SIGNATURE), repondreA: f.repondreA };
}

// Le récapitulatif quand il y en a trop d'un coup : une ligne de titre et ses chiffres par alerte.
export function recapitulatif(alertes: Alerte[]): Courrier {
  const blocs: Bloc[] = [`Il s'en est passé, des choses : ${alertes.length} nouvelles d'un coup. Je te range tout ça.`];
  for (const a of alertes) {
    const f = fiche(a);
    blocs.push(`${f.sujet} · ${heure(a.created_at)}`);
    for (const b of f.blocs) {
      if (typeof b === "object" && "lignes" in b) blocs.push(b);
      else if (typeof b === "string" && b.startsWith("«")) blocs.push(b);
    }
  }
  return composer(`📬 ${alertes.length} nouvelles chez Michel`, "Mathieu", blocs, SIGNATURE);
}
