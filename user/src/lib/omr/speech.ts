import * as Speech from "expo-speech";
import { Platform } from "react-native";

/**
 * The score said aloud, so the teacher can keep their eyes on the next sheet.
 *
 * In the app's language when the phone has a voice for it; otherwise only the
 * two numbers, in the phone's own voice — a Russian voice reading an Uzbek
 * sentence is worse than "18, 20". Uzbek voices are rare on phones, so that is
 * the usual case in Uzbek.
 */

let voices: Promise<string[]> | null = null;

/** The languages the phone can speak, asked once. An empty answer is not kept: Android's engine may still be starting. */
function voiceLanguages(): Promise<string[]> {
  if (!voices) {
    const asked = Speech.getAvailableVoicesAsync()
      .then((list) => list.map((voice) => voice.language))
      .catch(() => [] as string[]);
    voices = asked;
    void asked.then((list) => { if (!list.length && voices === asked) voices = null; });
  }
  return voices;
}

/** Asks for the voices early, so the first score is not held up by the question. */
export function prepareSpeech(): void {
  if (Platform.OS !== "web") void voiceLanguages();
}

/** The phone's own spelling of `language` (e.g. "ru-RU" for "ru"), or null when it has no voice for it. */
async function voiceFor(language: string): Promise<string | null> {
  const wanted = language.toLowerCase();
  const list = await voiceLanguages();
  return list.find((code) => {
    const lower = code.toLowerCase().replace("_", "-");
    return lower === wanted || lower.startsWith(`${wanted}-`);
  }) ?? null;
}

export async function speakScore({ score, total, language, sentence }: {
  score: number; total: number; language: string; sentence: string;
}): Promise<void> {
  if (Platform.OS === "web") return;
  const voice = await voiceFor(language);
  await Speech.stop().catch(() => undefined);
  if (voice) Speech.speak(sentence, { language: voice });
  else Speech.speak(`${score}, ${total}`);
}

/** Leaving the scanner: no score is said over whatever the teacher opens next. */
export function stopSpeaking(): void {
  if (Platform.OS !== "web") void Speech.stop().catch(() => undefined);
}
