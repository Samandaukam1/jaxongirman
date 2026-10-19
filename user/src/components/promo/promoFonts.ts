import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic";
import { CormorantGaramond_700Bold } from "@expo-google-fonts/cormorant-garamond/700Bold";
import { Lora_400Regular } from "@expo-google-fonts/lora/400Regular";
import { Lora_400Regular_Italic } from "@expo-google-fonts/lora/400Regular_Italic";
import { Lora_700Bold } from "@expo-google-fonts/lora/700Bold";
import { Lora_700Bold_Italic } from "@expo-google-fonts/lora/700Bold_Italic";
import { PlayfairDisplay_400Regular_Italic } from "@expo-google-fonts/playfair-display/400Regular_Italic";
import { PlayfairDisplay_800ExtraBold } from "@expo-google-fonts/playfair-display/800ExtraBold";
import type { PromoFont } from "@jaxongirman/types";
import { useFonts } from "expo-font";

/**
 * The typefaces an article can be set in.
 *
 * Imported weight by weight rather than from each family's index, which would
 * bundle every weight of every face. Loaded by the article screen alone, the
 * first time one is opened — nothing else in the app pays for them.
 */
const FACES = {
  PlayfairDisplay_800ExtraBold,
  PlayfairDisplay_400Regular_Italic,
  Lora_400Regular,
  Lora_400Regular_Italic,
  Lora_700Bold,
  Lora_700Bold_Italic,
  CormorantGaramond_700Bold,
  CormorantGaramond_500Medium_Italic,
};

export function usePromoFonts(): boolean {
  const [loaded, failed] = useFonts(FACES);
  // A face that fails to load is not a reason to hold the article back: the
  // system face stands in for it.
  return loaded || Boolean(failed);
}

export type PromoFaces = {
  /** The title and headings. */
  display: string;
  /** Running text, and its bold, italic and bold-italic cuts. */
  body: string;
  bodyBold: string;
  bodyItalic: string;
  bodyBoldItalic: string;
  /** Pull quotes. */
  quote: string;
  /** Faces without a true italic are slanted by the renderer instead. */
  synthesizeItalic: boolean;
};

export function promoFaces(font: PromoFont, ready: boolean): PromoFaces {
  if (font === "modern" || !ready) {
    return {
      display: "Manrope_800ExtraBold",
      body: "Manrope_500Medium",
      bodyBold: "Manrope_800ExtraBold",
      bodyItalic: "Manrope_500Medium",
      bodyBoldItalic: "Manrope_800ExtraBold",
      quote: "Manrope_700Bold",
      synthesizeItalic: true,
    };
  }
  if (font === "classic") {
    return {
      display: "CormorantGaramond_700Bold",
      body: "Lora_400Regular",
      bodyBold: "Lora_700Bold",
      bodyItalic: "Lora_400Regular_Italic",
      bodyBoldItalic: "Lora_700Bold_Italic",
      quote: "CormorantGaramond_500Medium_Italic",
      synthesizeItalic: false,
    };
  }
  return {
    display: "PlayfairDisplay_800ExtraBold",
    body: "Lora_400Regular",
    bodyBold: "Lora_700Bold",
    bodyItalic: "Lora_400Regular_Italic",
    bodyBoldItalic: "Lora_700Bold_Italic",
    quote: "PlayfairDisplay_400Regular_Italic",
    synthesizeItalic: false,
  };
}
