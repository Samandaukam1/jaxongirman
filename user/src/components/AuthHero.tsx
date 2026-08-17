import { LinearGradient } from "expo-linear-gradient";
import { Gamepad2, House, Layers, Store, User, type LucideIcon } from "lucide-react-native";
import { Image, StyleSheet, Text, View } from "react-native";

import appIcon from "../../assets/icon.png";
import coinIcon from "../../assets/coin/coin-icon.png";
import { colors, typography } from "@/theme/tokens";

/**
 * What the app is, before anybody has signed in to find out.
 *
 * The five orbiting marks are the five places the bottom bar leads to, in the
 * order it draws them, plus the coin the whole economy runs on. That is not
 * decoration chosen for looking busy: somebody arriving at this screen is
 * deciding whether to make an account, and the honest answer to "what is in
 * there" is the tabs they will land among.
 *
 * The mascot sits in the middle because it is the app's face everywhere else —
 * the store listing, the home screen, the splash. Meeting it here first means
 * the icon they tapped and the screen that opened are recognisably the same
 * thing.
 */

const ORBIT = 98;
const STICKER = 58;

/**
 * Where each mark sits, in degrees clockwise from three o'clock.
 *
 * Twelve and six o'clock are deliberately empty: a mark at the top would
 * crowd the notch on a short phone, and one at the bottom would collide with
 * the title. The remaining six read as a ring anyway — the eye completes it.
 */
const MARKS: { icon: LucideIcon; angle: number; from: string; to: string }[] = [
  { icon: House, angle: 215, from: "#8B54E8", to: "#5B21B6" },
  { icon: Layers, angle: 325, from: "#38BDF8", to: "#1D4ED8" },
  { icon: Store, angle: 165, from: "#F472B6", to: "#BE185D" },
  { icon: Gamepad2, angle: 15, from: "#FBBF24", to: "#D97706" },
  { icon: User, angle: 115, from: "#2DD4BF", to: "#0D9488" },
];

function polar(angle: number): { left: number; top: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    left: ORBIT + Math.cos(radians) * ORBIT - STICKER / 2,
    top: ORBIT + Math.sin(radians) * ORBIT - STICKER / 2,
  };
}

export function AuthHero() {
  return (
    <View style={styles.wrapper}>
      <View style={styles.orbit}>
        {/* The ring the marks sit on, drawn faintly so the arrangement reads as
            deliberate rather than scattered. */}
        <View style={styles.guide} />

        {MARKS.map((mark) => (
          <View key={mark.angle} style={[styles.sticker, polar(mark.angle)]}>
            <LinearGradient
              colors={[mark.from, mark.to]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.stickerFill}
            >
              <mark.icon color="#FFFFFF" size={26} strokeWidth={2.2} />
            </LinearGradient>
          </View>
        ))}

        {/* The coin is the app's own artwork rather than a glyph in a gradient
            box, so it keeps its gold and its weight — it is a currency, and the
            one mark here that stands for something a person owns. */}
        <View style={[styles.sticker, styles.coinSticker, polar(65)]}>
          <Image source={coinIcon} style={styles.coinImage} resizeMode="contain" />
        </View>

        <View style={styles.logo}>
          <Image source={appIcon} style={styles.logoImage} resizeMode="cover" />
        </View>
      </View>

      <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: "center", gap: 18 },
  orbit: { width: ORBIT * 2, height: ORBIT * 2, alignItems: "center", justifyContent: "center" },

  guide: {
    position: "absolute",
    width: ORBIT * 2, height: ORBIT * 2, borderRadius: ORBIT,
    borderWidth: 1.5, borderColor: "#E7DDF8", borderStyle: "dashed",
  },

  sticker: {
    position: "absolute",
    width: STICKER, height: STICKER, borderRadius: 19,
    // The white keyline is what makes each mark read as a sticker laid on the
    // page rather than a coloured hole cut into it.
    borderWidth: 3, borderColor: "#FFFFFF", backgroundColor: "#FFFFFF",
    shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  stickerFill: { flex: 1, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  coinSticker: { backgroundColor: "#FFF8E7", alignItems: "center", justifyContent: "center" },
  coinImage: { width: STICKER - 12, height: STICKER - 12 },

  logo: {
    width: 92, height: 92, borderRadius: 28, overflow: "hidden",
    borderWidth: 3, borderColor: "#FFFFFF", backgroundColor: colors.primarySoft,
    shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  logoImage: { width: "100%", height: "100%" },

  eyebrow: {
    ...typography.caption,
    color: colors.primary, letterSpacing: 3, fontFamily: "Manrope_700Bold",
  },
});
