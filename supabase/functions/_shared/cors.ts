// En-têtes CORS des fonctions appelées par le site et les applis : les origines permises viennent de
// ALLOWED_ORIGINS (« * » par défaut), sinon on répond avec la première de la liste.
// Les écrans embarqués de l'appli de bureau (bureau/, Tauri) appellent depuis tauri://localhost (Mac, Linux)
// ou http://tauri.localhost (Windows) : toujours permis, sans toucher au secret ALLOWED_ORIGINS.
const BUREAU = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
const allowedOrigins = [
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((o) => o.trim()),
  ...BUREAU,
];

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = allowedOrigins.includes("*") ? "*" : origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

// Un navigateur d'un autre site n'a rien à faire ici (appels sans Origin, hors navigateur, tolérés).
export const origineRefusee = (origin: string | null) =>
  !!origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin);
