// Mise en page de la story « le dicton de Michel » (1080 × 1920), décrite pour satori.
// Aucune dépendance : le fichier se teste aussi hors de Supabase.

export type Kind = "dicton" | "coup_de_gueule";

export const LARGEUR = 1080;
export const HAUTEUR = 1920;

const CREME = "#FBF4E8";
const BRIQUE = "#7A2E1D";
const MOUTARDE = "#D9A441";
const ENCRE = "#2B2420";

const TITRES: Record<Kind, string> = {
  dicton: "Le dicton de Michel",
  coup_de_gueule: "Le coup de gueule de Michel",
};

// La bobine de Michel (même dessin que les visuels des réseaux).
const VISAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPjxjaXJjbGUgY3g9IjUxMiIgY3k9IjUxMiIgcj0iNTAwIiBmaWxsPSIjRDlBNDQxIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNTEyIDUxMikgc2NhbGUoMS4yNSkgdHJhbnNsYXRlKC01MTIgLTU2MCkiPjxwYXRoIGZpbGw9IiNGQkY0RTgiIGQ9Ik01MTIgMzcyYzE1MCAwIDI1MCA5MiAyNTAgMjIyIDAgMTMwLTEwMCAyMjAtMjUwIDIyMC0zNCAwLTY2LTUtOTUtMTRsLTkyIDU2Yy0xNCA5LTMwLTUtMjQtMjBsMzAtNzRjLTQ0LTQwLTY5LTk4LTY5LTE2OCAwLTEzMCAxMDAtMjIyIDI1MC0yMjJ6Ii8+IDxjaXJjbGUgY3g9IjM5OCIgY3k9IjY1MiIgcj0iMzQiIGZpbGw9IiNFMDhBNkUiIG9wYWNpdHk9Ii4zNSIvPiA8Y2lyY2xlIGN4PSI2MjYiIGN5PSI2NTIiIHI9IjM0IiBmaWxsPSIjRTA4QTZFIiBvcGFjaXR5PSIuMzUiLz4gPGcgc3Ryb2tlPSIjMkIyNDIwIiBzdHJva2Utd2lkdGg9IjMwIiBzdHJva2UtbGluZWNhcD0icm91bmQiIGZpbGw9Im5vbmUiPjxwYXRoIGQ9Ik0zOTggNTI4bDc4IDIyIi8+PHBhdGggZD0iTTYyNiA1MjhsLTc4IDIyIi8+PC9nPiA8Y2lyY2xlIGN4PSI0NDYiIGN5PSI1OTAiIHI9IjE3IiBmaWxsPSIjMkIyNDIwIi8+IDxjaXJjbGUgY3g9IjU3OCIgY3k9IjU5MCIgcj0iMTciIGZpbGw9IiMyQjI0MjAiLz4gPHBhdGggZmlsbD0iIzJCMjQyMCIgZD0iTTUxMiA2NjRjLTMwLTE2LTc4LTIyLTExOC00LTI2IDEyLTQ0IDM0LTUwIDU4LTQgMTQgMTIgMjIgMjIgMTIgMjItMjAgNTItMjYgODItMTYgMjYgOSA0NiAxMiA2NCA0IDE4IDggMzggNSA2NC00IDMwLTEwIDYwLTQgODIgMTYgMTAgMTAgMjYgMiAyMi0xMi02LTI0LTI0LTQ2LTUwLTU4LTQwLTE4LTg4LTEyLTExOCA0eiIvPiA8ZWxsaXBzZSBjeD0iNTEyIiBjeT0iNjM2IiByeD0iNDAiIHJ5PSIzNiIgZmlsbD0iI0UwOEE2RSIvPiA8ZWxsaXBzZSBjeD0iNTAwIiBjeT0iNjI0IiByeD0iMTIiIHJ5PSI5IiBmaWxsPSIjZmZmIiBvcGFjaXR5PSIuMzUiLz4gPHBhdGggZD0iTTUyMCAyOThjNC0yNCAxOC00MCAzNC00NCIgc3Ryb2tlPSIjMkIyNDIwIiBzdHJva2Utd2lkdGg9IjE2IiBzdHJva2UtbGluZWNhcD0icm91bmQiIGZpbGw9Im5vbmUiLz48cGF0aCBmaWxsPSIjMkIyNDIwIiBkPSJNMjY4IDQ0MGMtMTAtNzAgNTAtMTMwIDE2MC0xNDggMTIwLTIwIDI1MCA0IDMzMCA1OCAzNCAyMyA0NiA1MiAzMiA3MC0xMCAxMi0zMCAxNC01MiAxMC0xNTAtMjQtMzAwLTI2LTQ0MCAyMi0xNiA0LTI4IDItMzAtMTJ6Ii8+PC9nPjwvc3ZnPg==";

const COLLINES = "data:image/svg+xml;base64," + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="360" viewBox="0 0 1080 360">' +
    '<path d="M0 120 C 200 60 360 110 540 120 S 900 70 1080 40 V360 H0Z" fill="#A3AE6A"/>' +
    '<path d="M0 200 C 240 150 460 185 660 200 S 960 170 1080 150 V360 H0Z" fill="#7E8F4E"/></svg>',
);

type Noeud = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Noeud => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

const img = (src: string, style: Record<string, unknown>): Noeud => ({
  type: "img",
  props: { src, width: style.width, height: style.height, style },
});

// Espaces insécables à la française, pour qu'un « ? » ne parte pas seul à la ligne.
const typo = (s: string) => s.replace(/ ([?!:;»])/g, " $1").replace(/« /g, "« ");

// Plus le texte est long, plus la police diminue (150 caractères au plus en temps normal).
const taille = (n: number) => (n <= 70 ? 92 : n <= 110 ? 80 : n <= 160 ? 64 : 54);

export function carte(texte: string, kind: Kind, date: string): Noeud {
  const coupDeGueule = kind === "coup_de_gueule";
  return h(
    "div",
    {
      width: LARGEUR,
      height: HAUTEUR,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      position: "relative",
      backgroundColor: coupDeGueule ? MOUTARDE : CREME,
      fontFamily: "Fraunces",
      color: ENCRE,
    },
    img(COLLINES, { position: "absolute", left: 0, bottom: 0, width: 1080, height: 360 }),
    // Le haut et le bas d'une story sont cachés par l'interface d'Instagram : on reste au milieu.
    h(
      "div",
      { marginTop: 270, flexShrink: 0, display: "flex", backgroundColor: coupDeGueule ? BRIQUE : MOUTARDE, color: coupDeGueule ? CREME : ENCRE, fontSize: 50, fontWeight: 800, padding: "14px 44px 20px", borderRadius: 50 },
      TITRES[kind],
    ),
    h("div", { marginTop: 22, marginBottom: 40, flexShrink: 0, display: "flex", fontSize: 40, fontWeight: 700, fontStyle: "italic", color: coupDeGueule ? BRIQUE : "#8a7a66" }, date),
    h(
      "div",
      { flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 72, paddingRight: 72 },
      h(
        "div",
        { display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: coupDeGueule ? CREME : BRIQUE, color: coupDeGueule ? ENCRE : CREME, borderRadius: 48, padding: "56px 60px 64px", boxShadow: "0 12px 0 " + (coupDeGueule ? "#B9862F" : "#5E2214") },
        h("div", { display: "flex", fontSize: 150, lineHeight: 0.8, fontWeight: 800, color: coupDeGueule ? BRIQUE : MOUTARDE, marginBottom: 6 }, "«"),
        h("div", { display: "flex", textAlign: "center", fontSize: taille(texte.length), fontWeight: 800, lineHeight: 1.18 }, typo(texte)),
      ),
    ),
    h(
      "div",
      { marginBottom: 280, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" },
      img(VISAGE, { width: 200, height: 200, marginBottom: 24, borderRadius: 100, border: coupDeGueule ? "8px solid " + CREME : "none" }),
      h("div", { display: "flex", backgroundColor: BRIQUE, color: CREME, fontSize: 50, fontWeight: 800, padding: "10px 44px 18px", borderRadius: 44 }, "michel.beer"),
    ),
  );
}
