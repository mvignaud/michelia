// Fonction « recu » : un reçu ou un avoir de « Mes reçus » (espace compte), à la demande de son propriétaire.
// {numero} (R… ou A…) rend le PDF (le site le télécharge) ; {numero, email: true} le renvoie par e-mail à l'adresse
// du paiement (les applis, qui n'ont pas de téléchargement). La liste des reçus du compte vient de
// mes_recus(), appelée avec le jeton du visiteur : un reçu qui n'y est pas n'existe pas pour lui.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { envoyerAvoir, envoyerRecu, pdfAvoir, pdfRecu, type Recu } from "../_shared/recu.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });

type Ligne = { numero: string; date: string; genre: string; libelle: string; montant_cents: number; rembourse_cents: number; recu: string | null };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non permise" }, origin);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Corps illisible" }, origin);
  }
  const numero = typeof body?.numero === "string" ? body.numero : "";
  if (!/^[RA]\d{4}-\d{6}$/.test(numero)) return reply(400, { error: "Reçu inconnu" }, origin);

  const authorization = req.headers.get("authorization") ?? "";
  const visiteur = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: liste, error } = await visiteur.rpc("mes_recus");
  if (error) return reply(401, { error: "Connecte-toi pour retrouver tes reçus" }, origin);
  const pieces = (liste as Ligne[] | null) ?? [];
  const piece = pieces.find((r) => r.numero === numero);
  // Un avoir se rattache au reçu qu'il rembourse.
  const ligne = piece?.genre === "avoir" ? pieces.find((r) => r.numero === piece.recu) : piece;
  if (!piece || !ligne) return reply(404, { error: "Reçu inconnu" }, origin);

  const { data: p } = await admin.from("pourboires")
    .select("created_at, email, prenom, facture_code, facture_reglee_at, paiement_id, paiement_carte")
    .eq("numero_recu", ligne.numero)
    .maybeSingle();
  if (!p) return reply(404, { error: "Reçu inconnu" }, origin);

  const recu: Recu = {
    numero: ligne.numero,
    facture: p.facture_reglee_at ? p.facture_code : null,
    date: new Date(p.created_at),
    email: p.email ?? "",
    prenom: p.prenom,
    libelle: ligne.libelle,
    montantTtcCents: ligne.montant_cents,
    moyen: "Carte bancaire",
    transaction: p.paiement_carte ?? p.paiement_id,
    rembourseCents: ligne.rembourse_cents,
  };

  const avoir = piece.genre === "avoir"
    ? { numero, montantCents: piece.montant_cents, date: new Date(piece.date), recu }
    : null;

  if (body.email === true) {
    if (!p.email) return reply(400, { error: "Pas d'adresse e-mail sur ce paiement" }, origin);
    return (await (avoir ? envoyerAvoir(avoir) : envoyerRecu(recu)))
      ? reply(200, { ok: true, email: p.email }, origin)
      : reply(502, { error: "L'e-mail n'est pas parti, réessaie plus tard" }, origin);
  }

  return new Response(avoir ? await pdfAvoir(avoir) : await pdfRecu(recu), {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${avoir ? "avoir" : "recu"}-michel-${numero}.pdf"`,
    },
  });
});
