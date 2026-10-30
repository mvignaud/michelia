import { memo, useId } from 'react';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { colorOf, type Avatar as AvatarConfig } from './avatar';

const INK = '#2B2420';

// Dessin de la bobine, en vectoriel (100 × 100), découpé en rond.
function AvatarImage({ avatar, size = 40 }: { avatar: AvatarConfig; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const skin = colorOf('peau', avatar.peau);
  const shade = 'rgba(80, 40, 20, 0.22)';
  // Poils de la tête et du visage ; un caillou garde des sourcils gris.
  const hair = avatar.cheveux === 'chauve' && avatar.couleur !== 'blanc' ? colorOf('couleur', 'gris') : colorOf('couleur', avatar.couleur);
  const brow = avatar.couleur === 'blanc' || avatar.couleur === 'blond' ? '#8C7A62' : hair;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Ta bobine">
      <Defs>
        <ClipPath id={`rond${uid}`}>
          <Circle cx={50} cy={50} r={50} />
        </ClipPath>
        <ClipPath id={`habit${uid}`}>
          <Path d="M12 100 Q14 76 50 73 Q86 76 88 100 Z" />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#rond${uid})`}>
        <Rect x={0} y={0} width={100} height={100} fill={colorOf('fond', avatar.fond)} />

        {/* Cheveux de derrière */}
        {avatar.cheveux === 'longs' && <Path d="M25 48 C24 26 36 19 50 19 C64 19 76 26 75 48 L77 80 Q50 88 23 80 Z" fill={hair} />}
        {avatar.cheveux === 'chignon' && <Circle cx={50} cy={17} r={9} fill={hair} />}

        {/* Habit, cou */}
        <Habit kind={avatar.haut} clip={`url(#habit${uid})`} />
        <Rect x={43} y={62} width={14} height={14} rx={4} fill={skin} />
        <Rect x={43} y={62} width={14} height={6} fill={shade} />

        {/* Tête */}
        <Circle cx={29} cy={49} r={4.5} fill={skin} />
        <Circle cx={71} cy={49} r={4.5} fill={skin} />
        <Ellipse cx={50} cy={46} rx={21} ry={23} fill={skin} />

        {/* Barbe (sous la bouche) */}
        {(avatar.pilosite === 'collier' || avatar.pilosite === 'barbe') && (
          <Path d="M29 47 C28 64 37 74 50 74 C63 74 72 64 71 47 C69 57 63 63.5 50 63.5 C37 63.5 31 57 29 47 Z" fill={hair} />
        )}

        {avatar.joues === 'oui' && (
          <>
            <Circle cx={37} cy={54} r={4.5} fill="#E0705A" opacity={0.45} />
            <Circle cx={63} cy={54} r={4.5} fill="#E0705A" opacity={0.45} />
          </>
        )}

        {/* Sourcils */}
        {avatar.sourcils === 'fronces' ? (
          <Path d="M37 38 L46 41 M63 38 L54 41" stroke={brow} strokeWidth={2.6} strokeLinecap="round" />
        ) : (
          <Path d="M37.5 39.5 Q42 37 46 39 M54 39 Q58 37 62.5 39.5" stroke={brow} strokeWidth={2.4} strokeLinecap="round" fill="none" />
        )}

        <Yeux kind={avatar.yeux} />

        {/* Nez */}
        {avatar.nez === 'patate' ? (
          <Ellipse cx={50} cy={52.5} rx={4.6} ry={3.9} fill={shade} />
        ) : (
          <Path d="M50.5 47 Q47.5 53 50.5 54.5" stroke={shade} strokeWidth={2} strokeLinecap="round" fill="none" />
        )}

        <Bouche kind={avatar.bouche} />

        {/* Moustache (par-dessus la bouche) */}
        {(avatar.pilosite === 'gauloise' || avatar.pilosite === 'barbe') && (
          <Path d="M50 55.5 C44 54 39 56 37 61 C41 58.5 45 58.5 50 58 C55 58.5 59 58.5 63 61 C61 56 56 54 50 55.5 Z" fill={hair} />
        )}
        {avatar.pilosite === 'guidon' && (
          <Path
            d="M50 55.5 C45 54 40 56 38 58 C36 59.5 34 58 34.5 56 C33 59 36 61.5 40 60 C44 58.8 47 58.6 50 58.4 C53 58.6 56 58.8 60 60 C64 61.5 67 59 65.5 56 C66 58 64 59.5 62 58 C60 56 55 54 50 55.5 Z"
            fill={hair}
          />
        )}

        <Cheveux kind={avatar.cheveux} color={hair} />
        <Lunettes kind={avatar.lunettes} />
        <Chapeau kind={avatar.chapeau} />
      </G>
    </Svg>
  );
}

export const AvatarView = memo(AvatarImage);

function Habit({ kind, clip }: { kind: AvatarConfig['haut']; clip: string }) {
  const body = 'M12 100 Q14 76 50 73 Q86 76 88 100 Z';
  if (kind === 'mariniere') {
    return (
      <G clipPath={clip}>
        <Path d={body} fill="#FFFFFF" />
        {[79, 86, 93].map((y) => (
          <Rect key={y} x={0} y={y} width={100} height={3.4} fill="#1F3A6B" />
        ))}
      </G>
    );
  }
  if (kind === 'vichy') {
    return (
      <G clipPath={clip}>
        <Path d={body} fill="#F4D5CF" />
        {[14, 24, 34, 44, 54, 64, 74, 84].map((x) => (
          <Rect key={`x${x}`} x={x} y={70} width={5} height={30} fill="#B5402F" opacity={0.55} />
        ))}
        {[75, 85, 95].map((y) => (
          <Rect key={`y${y}`} x={0} y={y} width={100} height={5} fill="#B5402F" opacity={0.55} />
        ))}
      </G>
    );
  }
  if (kind === 'bleu') {
    return (
      <G>
        <Path d={body} fill="#3E5C8A" />
        <Path d="M40 75 L50 86 L60 75" stroke="#2C4468" strokeWidth={3} fill="none" strokeLinejoin="round" />
      </G>
    );
  }
  return <Path d={body} fill="#C9862F" />;
}

function Yeux({ kind }: { kind: AvatarConfig['yeux'] }) {
  const point = (cx: number) => <Circle cx={cx} cy={46} r={2.7} fill={INK} />;
  const arc = (cx: number) => (
    <Path d={`M${cx - 3.6} 47 Q${cx} 43.2 ${cx + 3.6} 47`} stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  );
  const rond = (cx: number) => (
    <G>
      <Circle cx={cx} cy={46} r={4.4} fill="#FFFFFF" />
      <Circle cx={cx + 0.6} cy={46.4} r={2.3} fill={INK} />
    </G>
  );
  if (kind === 'ronds') return <G>{rond(42)}{rond(58)}</G>;
  if (kind === 'rieurs') return <G>{arc(42)}{arc(58)}</G>;
  if (kind === 'clin') return <G>{point(42)}{arc(58)}</G>;
  return <G>{point(42)}{point(58)}</G>;
}

function Bouche({ kind }: { kind: AvatarConfig['bouche'] }) {
  if (kind === 'rire') return <Path d="M43 58.5 Q50 68 57 58.5 Z" fill="#7A2E1D" stroke="#7A2E1D" strokeWidth={1.2} strokeLinejoin="round" />;
  if (kind === 'neutre') return <Path d="M45 61 L55 61" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />;
  if (kind === 'moue') return <Path d="M45 62.5 Q50 58.5 55 62.5" stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />;
  return <Path d="M44 59.5 Q50 64.5 56 59.5" stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />;
}

function Cheveux({ kind, color }: { kind: AvatarConfig['cheveux']; color: string }) {
  if (kind === 'court' || kind === 'longs' || kind === 'chignon') {
    return <Path d="M28 46 C27 28 38 21 50 21 C62 21 73 28 72 46 C70 36 63 31 52 31 C46 33 40 34 34 36 C31 39 29 42 28 46 Z" fill={color} />;
  }
  if (kind === 'frange') {
    return (
      <Path
        d="M28 46 C27 27 38 20 50 20 C62 20 73 27 72 46 C71 40 69 37 67 36 L64 41 L60 35 L55 40 L50 34 L45 40 L40 35 L36 41 L33 36 C31 38 29 41 28 46 Z"
        fill={color}
      />
    );
  }
  if (kind === 'boucles') {
    const curls: [number, number][] = [[30, 40], [31, 31], [37, 24], [45, 20], [55, 20], [63, 24], [69, 31], [70, 40]];
    return (
      <G>
        {curls.map(([cx, cy]) => (
          <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={7} fill={color} />
        ))}
      </G>
    );
  }
  if (kind === 'couronne') {
    return (
      <G>
        <Path d="M28.5 47 Q26 35 33 29 Q31 38 33 46 Z" fill={color} />
        <Path d="M71.5 47 Q74 35 67 29 Q69 38 67 46 Z" fill={color} />
      </G>
    );
  }
  return null;
}

function Lunettes({ kind }: { kind: AvatarConfig['lunettes'] }) {
  const frame = '#3A2E28';
  if (kind === 'rondes' || kind === 'soleil') {
    const fill = kind === 'soleil' ? INK : 'none';
    return (
      <G>
        <Circle cx={42} cy={46} r={6.5} stroke={frame} strokeWidth={1.8} fill={fill} opacity={kind === 'soleil' ? 0.9 : 1} />
        <Circle cx={58} cy={46} r={6.5} stroke={frame} strokeWidth={1.8} fill={fill} opacity={kind === 'soleil' ? 0.9 : 1} />
        <Path d="M48.5 45.5 Q50 44 51.5 45.5 M35.5 45 L30 43.5 M64.5 45 L70 43.5" stroke={frame} strokeWidth={1.8} fill="none" />
      </G>
    );
  }
  if (kind === 'carrees') {
    return (
      <G>
        <Rect x={35} y={41} width={13} height={10} rx={2} stroke={frame} strokeWidth={1.8} fill="none" />
        <Rect x={52} y={41} width={13} height={10} rx={2} stroke={frame} strokeWidth={1.8} fill="none" />
        <Path d="M48 45 L52 45 M35 44 L30 43 M65 44 L70 43" stroke={frame} strokeWidth={1.8} />
      </G>
    );
  }
  return null;
}

function Chapeau({ kind }: { kind: AvatarConfig['chapeau'] }) {
  if (kind === 'beret') {
    return (
      <G>
        <Path d="M24 32 C21 20 36 13 53 14 C69 15 79 22 76 31 C69 34.5 59 34 50 34 C40 34 31 34.5 24 32 Z" fill="#1F2633" />
        <Path d="M53 14 L54.5 9.5" stroke="#1F2633" strokeWidth={2.4} strokeLinecap="round" />
      </G>
    );
  }
  if (kind === 'casquette') {
    return (
      <G>
        <Path d="M28 35 C27 21 39 15 50 15 C61 15 73 21 72 35 Z" fill="#5E7A34" />
        <Path d="M52 33 Q72 30 84 36 Q70 39.5 52 37 Z" fill="#4A6128" />
        <Circle cx={50} cy={15.5} r={2} fill="#4A6128" />
      </G>
    );
  }
  if (kind === 'paille') {
    return (
      <G>
        <Path d="M33 31 C33 15 67 15 67 31 Z" fill="#E3C16F" />
        <Rect x={33} y={26} width={34} height={4} fill="#B5402F" />
        <Ellipse cx={50} cy={31} rx={34} ry={6} fill="#D9B25A" />
      </G>
    );
  }
  return null;
}
