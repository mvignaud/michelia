import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule as Reco,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition';

// Dictée : la reconnaissance vocale de l'appareil (Siri sur iPhone, Google sur Android,
// le navigateur sur le web) écrit dans la zone de saisie. Rien ne part vers nos serveurs
// avant que la personne appuie sur Envoyer : elle relit ce que Michel a compris.

// Mots que la reconnaissance a du mal à deviner toute seule (iOS surtout).
const VOCABULAIRE = ['Michel', 'MichelIA', 'Burosse', 'Gers', 'adishatz', 'miladiou', 'garbure', 'armagnac'];

// Firefox, Brave sans moteur, vieux Android sans service Google : pas de bouton micro.
function disponible(): boolean {
  try {
    return Reco.isRecognitionAvailable();
  } catch {
    return false;
  }
}

function joindre(avant: string, dit: string): string {
  const debut = avant.trimEnd();
  return debut ? `${debut} ${dit}` : dit;
}

function messageErreur(code: ExpoSpeechRecognitionErrorCode): string | null {
  switch (code) {
    case 'aborted':
    case 'no-speech':
    case 'speech-timeout':
      return null; // On a coupé, ou rien entendu : pas la peine d'en faire un fromage.
    case 'not-allowed':
      return "Hè, sans le micro je t'entends pas, con ! Autorise-le dans les réglages et réessaie.";
    case 'service-not-allowed':
    case 'language-not-supported':
      return "La dictée marche pas sur cet appareil, con. Sur iPhone, active « Siri et Dictée » ; sur Android, la reconnaissance vocale Google. Sinon, tape au clavier, ça marche aussi.";
    case 'network':
      return Platform.OS === 'web'
        ? "J'ai rien pu entendre : soit le réseau coince, soit ton navigateur sait pas faire la dictée. Essaie avec Chrome ou Safari, con."
        : "Le tuyau est bouché, j'ai rien compris. Vérifie le réseau et recommence.";
    case 'busy':
    case 'too-many-requests':
      return 'Doucement, le micro est déjà pris. Attends deux secondes et recommence.';
    default:
      return "Pétard, j'ai rien entendu de propre. Recommence, ou écris-le, va.";
  }
}

type Options = {
  texte: string;
  setTexte: (texte: string) => void;
  // Michel prévient dans le fil quand le micro coince.
  signaler: (message: string) => void;
};

export function useDictee({ texte, setTexte, signaler }: Options) {
  const [disponibleIci] = useState(disponible);
  const [ecoute, setEcoute] = useState(false);
  // Texte déjà écrit au moment d'appuyer sur le micro : la dictée s'y ajoute.
  const avant = useRef('');
  // Faux dès qu'on coupe : les derniers résultats qui arrivent après sont ignorés.
  const actif = useRef(false);

  useSpeechRecognitionEvent('start', () => {
    if (actif.current) setEcoute(true);
  });
  useSpeechRecognitionEvent('end', () => {
    actif.current = false;
    setEcoute(false);
  });
  useSpeechRecognitionEvent('result', (e) => {
    const dit = e.results[0]?.transcript?.trim();
    if (actif.current && dit) setTexte(joindre(avant.current, dit));
  });
  useSpeechRecognitionEvent('error', (e) => {
    actif.current = false;
    setEcoute(false);
    const message = messageErreur(e.error);
    if (message) signaler(message);
  });

  // Couper le micro en quittant l'écran.
  useEffect(() => () => {
    if (actif.current) Reco.abort();
  }, []);

  async function demarrer() {
    // Sur le web, c'est le navigateur qui demande le micro au démarrage.
    const permission = Platform.OS === 'web' ? { granted: true } : await Reco.requestPermissionsAsync();
    if (!permission.granted) {
      signaler(messageErreur('not-allowed')!);
      return;
    }
    avant.current = texte;
    actif.current = true;
    Reco.start({
      lang: 'fr-FR',
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      contextualStrings: VOCABULAIRE,
    });
  }

  // Arrête l'écoute en gardant ce qui a été dit.
  function arreter() {
    Reco.stop();
  }

  // Arrête sans rien garder de plus (au moment d'envoyer le message).
  function couper() {
    if (!actif.current) return;
    actif.current = false;
    setEcoute(false);
    Reco.abort();
  }

  function basculer() {
    if (actif.current) arreter();
    else demarrer().catch(() => signaler(messageErreur('audio-capture')!));
  }

  return { disponible: disponibleIci, ecoute, basculer, couper };
}
