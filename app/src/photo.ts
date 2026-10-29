import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Photo prête à partir : JPEG réduit, en base64 sans préfixe (format attendu par la fonction « chat »).
export type Photo = { media_type: 'image/jpeg'; data: string; width: number; height: number };

// 1 024 px de côté au plus : assez pour que Michel voie le plat ou la facture,
// et ≈ 150 Ko et 1 400 jetons par photo au lieu de plusieurs Mo.
const MAX_SIDE = 1024;
const QUALITY = 0.7;

// Sur le web, le sélecteur de fichiers propose déjà l'appareil photo sur mobile.
// Dans les applis, on demande d'où vient la photo.
function chooseSource(): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert('Montrer une photo à Michel', undefined, [
      { text: 'Prendre une photo', onPress: () => resolve('camera') },
      { text: 'Choisir dans la galerie', onPress: () => resolve('library') },
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

// Demande une photo et la réduit avant l'envoi. null si la personne annule.
export async function pickPhoto(): Promise<Photo | null> {
  const source = await chooseSource();
  if (!source) return null;

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Hè, sans l'appareil photo je vois rien, con ! Autorise-le dans les réglages du téléphone.");
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_SIDE) {
    context.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
    if (!saved.base64) throw new Error('Hòu, ta photo est illisible. Essaie avec une autre.');
    return { media_type: 'image/jpeg', data: saved.base64, width: saved.width, height: saved.height };
  } finally {
    image.release();
    context.release();
  }
}

export const photoUri = (photo: Photo) => `data:${photo.media_type};base64,${photo.data}`;
