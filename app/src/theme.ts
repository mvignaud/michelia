import { Platform } from 'react-native';

// Palette « ferme gersoise » : lin, bois et armagnac, sur une mise en page sobre façon Apple.
export const colors = {
  background: '#FBF4E8',
  bar: 'rgba(253, 249, 242, 0.94)',
  surface: '#FFFFFF',
  text: '#2B2420',
  secondary: '#7D6E62',
  tertiary: '#A39586',
  separator: 'rgba(90, 60, 30, 0.16)',
  accent: '#7A2E1D',
  accentSoft: '#F3E3D3',
  ochre: '#D9A441',
  onAccent: '#FFF8EE',
  disabled: '#D8C9B9',
  failed: '#B5543F',
  online: '#6E8B3D',
};

export const serif = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'ui-serif, "New York", Georgia, serif',
});
