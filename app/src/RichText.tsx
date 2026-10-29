import { Text, type StyleProp, type TextStyle } from 'react-native';

// Mise en forme légère des réponses : **gras**, titres « # » et puces « - » / « * ».
// Le reste du Markdown s'affiche tel quel.
export function RichText({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const lines = text.split('\n').map((line) =>
    line.replace(/^#{1,6}\s+(.*)$/, '**$1**').replace(/^(\s*)[-*]\s+/, '$1• '),
  );
  return (
    <Text style={style}>
      {lines.map((line, i) => (
        <Text key={i}>
          {i > 0 ? '\n' : ''}
          {line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
            j % 2 ? (
              <Text key={j} style={{ fontWeight: '700' }}>
                {part}
              </Text>
            ) : (
              part
            ),
          )}
        </Text>
      ))}
    </Text>
  );
}
