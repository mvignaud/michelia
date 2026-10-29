// Carte image d'une réponse de Michel, à poster sur les réseaux : réglages communs
// à la version des applis (capture d'une vue) et à celle du web (dessin sur un canvas).
export type Card = { question?: string; answer: string };

export const CARD_WIDTH = 360;
export const CARD_RATIO = 1.25; // 4:5, le format portrait des fils Instagram et Facebook
export const CARD_SITE = 'michel.beer';
export const CARD_TAGLINE = 'Le papi du Gers coincé dans la machine';
export const CARD_LOGO = require('../assets/brand/logo-horizontal-negatif.png');
export const CARD_LOGO_RATIO = 600 / 204;

const MAX_ANSWER = 450;
const MAX_QUESTION = 140;

// Coupe un texte trop long pour la carte, à la fin d'une phrase si possible.
export function clip(text: string, max: number) {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = Math.max(...['. ', '! ', '? ', '\n'].map((end) => cut.lastIndexOf(end)));
  let short = sentence > max / 2 ? cut.slice(0, sentence + 1) : cut.slice(0, cut.lastIndexOf(' '));
  // Un **gras** coupé en deux s'afficherait avec ses étoiles.
  if ((short.match(/\*\*/g)?.length ?? 0) % 2) short = short.slice(0, short.lastIndexOf('**'));
  return `${short.trimEnd()} […]`;
}

export function makeCard(answer: string, question?: string): Card {
  return {
    answer: clip(answer, MAX_ANSWER),
    question: question ? clip(question.replace(/\s+/g, ' '), MAX_QUESTION) : undefined,
  };
}
