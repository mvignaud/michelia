import * as Sharing from 'expo-sharing';
import { useRef, type ComponentRef } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { RichText } from './RichText';
import { CARD_LOGO, CARD_LOGO_RATIO, CARD_RATIO, CARD_SITE, CARD_TAGLINE, CARD_WIDTH, type Card } from './shareCard';
import { colors, serif } from './theme';

// Applis : la carte est une vraie vue, photographiée au moment du partage.
export function useShareCard(card: Card) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const { width: screen } = useWindowDimensions();
  const width = Math.min(CARD_WIDTH, screen - 32);

  const preview = (
    <View ref={ref} collapsable={false} style={[styles.card, { width, minHeight: width * CARD_RATIO }]}>
      <Image source={CARD_LOGO} style={styles.logo} accessibilityLabel="MichelIA" />
      <View style={styles.middle}>
        {card.question && (
          <View style={styles.question}>
            <Text style={styles.questionText}>{card.question}</Text>
          </View>
        )}
        <View style={styles.answer}>
          <RichText text={card.answer} style={styles.answerText} />
        </View>
      </View>
      <View>
        <Text style={styles.site}>{CARD_SITE}</Text>
        <Text style={styles.tagline}>{CARD_TAGLINE}</Text>
      </View>
    </View>
  );

  async function share() {
    const uri = await captureRef(ref, { format: 'png', result: 'tmpfile', fileName: 'michel' });
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Partager la réponse de Michel',
    });
  }

  return { preview, share, label: 'Partager', ready: true };
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.accent,
    experimental_backgroundImage: 'linear-gradient(180deg, #9A3F2A, #5E2214)',
    padding: 22,
    justifyContent: 'space-between',
    gap: 18,
  },
  logo: { width: 150, height: 150 / CARD_LOGO_RATIO, marginLeft: -6 },
  middle: { gap: 10 },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    borderRadius: 18,
    borderBottomRightRadius: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: 'rgba(251, 244, 232, 0.16)',
  },
  questionText: { color: colors.background, fontSize: 14, lineHeight: 19 },
  answer: {
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: colors.background,
  },
  answerText: { color: colors.text, fontSize: 16, lineHeight: 23, fontFamily: serif },
  site: { color: colors.ochre, fontSize: 18, fontWeight: '800' },
  tagline: { color: 'rgba(251, 244, 232, 0.75)', fontSize: 12, marginTop: 2 },
});
