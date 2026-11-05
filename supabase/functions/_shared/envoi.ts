// L'envoi des e-mails de Michel, pour toutes les fonctions (reçus, avis, alertes, lettre, annonces…).
// SMTP2GO d'abord (secret SMTP2GO_API_KEY) : IP à bonne réputation, Gmail et Hotmail ne mettent plus
// Michel en spam. Postal (serveur d'E-KO, secrets POSTAL_API_URL + POSTAL_API_KEY) reste en secours :
// il sert seul tant que SMTP2GO n'est pas configuré, et rattrape un courrier que SMTP2GO refuse.

const SMTP2GO_API_URL = (Deno.env.get("SMTP2GO_API_URL") ?? "https://api.smtp2go.com/v3").replace(/\/+$/, "");
const SMTP2GO_API_KEY = (Deno.env.get("SMTP2GO_API_KEY") ?? "").trim();
const POSTAL_API_URL = (Deno.env.get("POSTAL_API_URL") ?? "").replace(/\/+$/, "");
const POSTAL_API_KEY = Deno.env.get("POSTAL_API_KEY") ?? "";

export const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Michel (MichelIA) <noreply@michel.beer>";
// Les réponses des gens arrivent dans la boîte de contact (l'expéditeur, lui, ne lit rien).
export const MAIL_REPLY_TO = Deno.env.get("MAIL_REPLY_TO") ?? "Michel (MichelIA) <contact@michel.beer>";

export type PieceJointe = { nom: string; type: string; base64: string };

export type Envoi = {
  to: string;
  sujet: string;
  texte: string;
  html: string;
  tag: string;
  replyTo?: string;
  bcc?: string[];
  headers?: Record<string, string>;
  pieces?: PieceJointe[];
};

// Vrai si au moins un fournisseur est configuré.
export const envoiConfigure = () => !!SMTP2GO_API_KEY || !!(POSTAL_API_URL && POSTAL_API_KEY);

async function parSmtp2go(e: Envoi): Promise<boolean> {
  try {
    const headers = { ...(e.headers ?? {}), "Reply-To": e.replyTo ?? MAIL_REPLY_TO, "X-Michel-Tag": e.tag };
    const response = await fetch(`${SMTP2GO_API_URL}/email/send`, {
      method: "POST",
      headers: { "X-Smtp2go-Api-Key": SMTP2GO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: MAIL_FROM,
        to: [e.to],
        ...(e.bcc?.length ? { bcc: e.bcc } : {}),
        subject: e.sujet,
        text_body: e.texte,
        html_body: e.html,
        custom_headers: Object.entries(headers).map(([header, value]) => ({ header, value })),
        ...(e.pieces?.length
          ? { attachments: e.pieces.map((p) => ({ filename: p.nom, mimetype: p.type, fileblob: p.base64 })) }
          : {}),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !(result?.data?.succeeded >= 1)) {
      console.error("SMTP2GO refuse le courrier", e.tag, response.status, JSON.stringify(result?.data ?? result));
      return false;
    }
    return true;
  } catch (err) {
    console.error("SMTP2GO injoignable :", err);
    return false;
  }
}

async function parPostal(e: Envoi): Promise<boolean> {
  try {
    const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
      method: "POST",
      headers: { "X-Server-API-Key": POSTAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [e.to],
        ...(e.bcc?.length ? { bcc: e.bcc } : {}),
        from: MAIL_FROM,
        reply_to: e.replyTo ?? MAIL_REPLY_TO,
        subject: e.sujet,
        plain_body: e.texte,
        html_body: e.html,
        tag: e.tag,
        ...(e.headers && Object.keys(e.headers).length ? { headers: e.headers } : {}),
        ...(e.pieces?.length
          ? { attachments: e.pieces.map((p) => ({ name: p.nom, content_type: p.type, data: p.base64 })) }
          : {}),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      console.error("Postal refuse le courrier", e.tag, response.status, JSON.stringify(result?.data ?? result));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Postal injoignable :", err);
    return false;
  }
}

// Envoie un e-mail ; false si personne n'est configuré ou si tout le monde refuse (l'appelant journalise).
export async function envoyerMail(e: Envoi): Promise<boolean> {
  if (SMTP2GO_API_KEY && (await parSmtp2go(e))) return true;
  if (POSTAL_API_URL && POSTAL_API_KEY) {
    if (SMTP2GO_API_KEY) console.warn("Repli sur Postal pour", e.tag);
    return parPostal(e);
  }
  return false;
}
