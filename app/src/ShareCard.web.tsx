import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CARD_LOGO, CARD_LOGO_RATIO, CARD_RATIO, CARD_SITE, CARD_TAGLINE, CARD_WIDTH, type Card } from './shareCard';
import { colors } from './theme';

// Web : la carte est dessinée sur un canvas, en 1080 px de large, puis partagée
// (feuille de partage du téléphone) ou téléchargée (ordinateur).
const SCALE = 3;
const PAD = 22;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CREAM_SOFT = 'rgba(251, 244, 232, 0.16)';

type Word = { text: string; bold: boolean };
type Line = Word[];

let logoLoading: Promise<HTMLImageElement> | null = null;
function loadLogo() {
  logoLoading ??= new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      logoLoading = null;
      reject(new Error('Logo introuvable'));
    };
    img.src = Asset.fromModule(CARD_LOGO).uri;
  });
  return logoLoading;
}

// Même mise en forme que RichText : **gras**, titres « # » et puces « - » / « * ».
function paragraphs(text: string): Line[] {
  return text.split('\n').map((raw) => {
    const line = raw.replace(/^#{1,6}\s+(.*)$/, '**$1**').replace(/^(\s*)[-*]\s+/, '$1• ');
    return line.split(/\*\*(.+?)\*\*/g).flatMap((part, i) =>
      part
        .split(/(\s+)/)
        .filter(Boolean)
        .map((text) => ({ text, bold: i % 2 === 1 })),
    );
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (bold: boolean) => string) {
  const lines: Line[] = [];
  for (const words of paragraphs(text)) {
    let line: Line = [];
    let width = 0;
    for (const word of words) {
      ctx.font = font(word.bold);
      const w = ctx.measureText(word.text).width;
      if (width + w > maxWidth && line.length && word.text.trim()) {
        lines.push(line);
        line = [];
        width = 0;
      }
      if (!line.length && !word.text.trim()) continue;
      line.push(word);
      width += w;
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  x: number,
  y: number,
  lineHeight: number,
  font: (bold: boolean) => string,
) {
  lines.forEach((line, i) => {
    let left = x;
    for (const word of line) {
      ctx.font = font(word.bold);
      ctx.fillText(word.text, left, y + i * lineHeight + lineHeight / 2);
      left += ctx.measureText(word.text).width;
    }
  });
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tail: 'left' | 'right') {
  const r = 18;
  const small = 5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, tail === 'left' ? [r, r, r, small] : [r, r, small, r]);
  ctx.fill();
}

async function drawCard(card: Card) {
  const logo = await loadLogo();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  const inner = CARD_WIDTH - PAD * 2;

  const answerFont = (bold: boolean) => `${bold ? '700' : '400'} 16px ${SERIF}`;
  const questionFont = (bold: boolean) => `${bold ? '700' : '400'} 14px ${SANS}`;
  const answerLines = wrap(ctx, card.answer, inner - 32, answerFont);
  const questionLines = card.question ? wrap(ctx, card.question, inner * 0.82 - 26, questionFont) : [];
  const questionWidth = Math.max(
    0,
    ...questionLines.map((line) => {
      ctx.font = questionFont(false);
      return ctx.measureText(line.map((w) => w.text).join('')).width;
    }),
  );

  const logoH = 150 / CARD_LOGO_RATIO;
  const questionH = questionLines.length ? questionLines.length * 19 + 16 : 0;
  const answerH = answerLines.length * 23 + 26;
  const middleH = questionH + (questionH ? 10 : 0) + answerH;
  const footerH = 40;
  const height = Math.max(CARD_WIDTH * CARD_RATIO, PAD * 2 + logoH + footerH + middleH + 36);

  canvas.width = CARD_WIDTH * SCALE;
  canvas.height = Math.round(height * SCALE);
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'middle';

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#9A3F2A');
  background.addColorStop(1, '#5E2214');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  ctx.drawImage(logo, PAD - 6, PAD, 150, logoH);

  // Les bulles au milieu de l'espace libre, entre le logo et le pied.
  const top = PAD + logoH;
  const bottom = height - PAD - footerH;
  let y = top + (bottom - top - middleH) / 2;
  if (questionLines.length) {
    const w = questionWidth + 26;
    ctx.fillStyle = CREAM_SOFT;
    bubble(ctx, CARD_WIDTH - PAD - w, y, w, questionH, 'right');
    ctx.fillStyle = colors.background;
    drawLines(ctx, questionLines, CARD_WIDTH - PAD - w + 13, y + 8, 19, questionFont);
    y += questionH + 10;
  }
  ctx.fillStyle = colors.background;
  bubble(ctx, PAD, y, inner, answerH, 'left');
  ctx.fillStyle = colors.text;
  drawLines(ctx, answerLines, PAD + 16, y + 13, 23, answerFont);

  ctx.fillStyle = colors.ochre;
  ctx.font = `800 18px ${SANS}`;
  ctx.fillText(CARD_SITE, PAD, height - PAD - 28);
  ctx.fillStyle = 'rgba(251, 244, 232, 0.75)';
  ctx.font = `400 12px ${SANS}`;
  ctx.fillText(CARD_TAGLINE, PAD, height - PAD - 7);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Image impossible à créer');
  return { blob, ratio: height / CARD_WIDTH };
}

function canShareFiles() {
  try {
    const file = new File([''], 'michel.png', { type: 'image/png' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function useShareCard(card: Card) {
  const [image, setImage] = useState<{ url: string; ratio: number }>();
  const [failed, setFailed] = useState(false);
  const blob = useRef<Blob | null>(null);
  const { width: screen } = useWindowDimensions();
  const width = Math.min(CARD_WIDTH, screen - 32);
  const native = useRef(canShareFiles()).current;

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    setImage(undefined);
    setFailed(false);
    drawCard(card)
      .then((drawn) => {
        if (cancelled) return;
        blob.current = drawn.blob;
        url = URL.createObjectURL(drawn.blob);
        setImage({ url, ratio: drawn.ratio });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card]);

  const preview = image ? (
    <Image
      source={{ uri: image.url }}
      style={{ width, height: width * image.ratio }}
      accessibilityLabel="Carte de la réponse de Michel"
    />
  ) : (
    <View style={[styles.placeholder, { width, height: width * CARD_RATIO }]}>
      {!failed && <ActivityIndicator color={colors.onAccent} />}
    </View>
  );

  async function share() {
    if (!blob.current || !image) throw new Error("L'image n'est pas prête.");
    const file = new File([blob.current], 'michel.png', { type: 'image/png' });
    // Rien à attendre avant navigator.share : le navigateur exige le geste de l'utilisateur.
    if (native) {
      try {
        await navigator.share({ files: [file], text: `Michel a parlé ! ${CARD_SITE}` });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        throw e;
      }
      return;
    }
    const link = document.createElement('a');
    link.href = image.url;
    link.download = 'michel.png';
    link.click();
  }

  return { preview, share, label: native ? 'Partager' : "Télécharger l'image", ready: !!image };
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
