import Svg, { Path } from "react-native-svg";

/**
 * The app's own "send" mark, drawn for this button rather than taken from the
 * icon set. Four drawings were offered; the person chose D (`SEND_STYLE`):
 *
 * - A — a folded paper plane: filled, soft corners, flying up and to the
 *   right, its fold cut through in the colour behind it;
 * - B — an origami plane: two wings and a crease;
 * - C — an arrow up, iOS-style;
 * - D — a soft triangle, flying right.
 */
export type SendStyle = "A" | "B" | "C" | "D";
export const SEND_STYLE: SendStyle = "D";

export function SendGlyph({ size = 20, color = "#FFFFFF", fold = "#6A35C8", variant = SEND_STYLE }: {
  size?: number;
  /** The mark. */
  color?: string;
  /** The fold or crease: the colour of what the mark sits on. */
  fold?: string;
  variant?: SendStyle;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {variant === "A" ? (
        <>
          <Path
            d="M3.62 10.73 19.24 3.6c1.07-.49 2.15.6 1.66 1.67l-7.13 15.6c-.47 1.03-1.98.94-2.31-.14l-1.62-5.19a1.6 1.6 0 0 0-1.06-1.06L3.76 12.95c-1.08-.34-1.17-1.85-.14-2.22Z"
            fill={color}
          />
          <Path d="M9.2 14.8 15.6 8.4" stroke={fold} strokeWidth={1.7} strokeLinecap="round" />
        </>
      ) : variant === "B" ? (
        <>
          <Path
            d="M2.6 10.9 20.6 3.3c.6-.25 1.2.35.95.95l-7.6 18c-.27.64-1.2.6-1.41-.06l-2.2-6.84a1 1 0 0 0-.65-.64L2.66 12.5c-.67-.22-.7-1.15-.06-1.6Z"
            fill={color}
          />
          <Path d="M9.7 14.3 21.2 3.8" stroke={fold} strokeWidth={1.5} strokeLinecap="round" />
          <Path d="M9.9 14.6l.9 4.9 2.3-3.1" fill={fold} fillOpacity={0.35} />
        </>
      ) : variant === "C" ? (
        <Path d="M12 19.5V5.2M5.6 11.2 12 4.8l6.4 6.4" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : (
        <Path
          d="M4.1 19.9 20.4 12.9c.75-.32.75-1.48 0-1.8L4.1 4.1c-.78-.33-1.57.42-1.3 1.22L4.9 11 12.6 12l-7.7 1-2.1 5.68c-.27.8.52 1.55 1.3 1.22Z"
          fill={color}
        />
      )}
    </Svg>
  );
}
