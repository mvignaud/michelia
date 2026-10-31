// Ce que partagent les envois groupés par e-mail (fonctions « annonces » et « lettre »).
const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET") ?? "";

// Jeton de désabonnement : HMAC de l'identifiant, pour qu'on ne puisse pas désabonner quelqu'un d'autre.
// La fonction « annonces » le vérifie, quelle que soit la fonction qui a écrit le lien.
export async function sign(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(UNSUBSCRIBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
