import { setAudioModeAsync } from "expo-audio";
import { Platform } from "react-native";

/**
 * The phone's audio session, set in one place, so every corner of the app
 * agrees on what it is for.
 *
 * Playback is the resting state. expo-audio sets no category of its own when
 * the app starts, and iOS begins every app in "solo ambient", which the
 * ring/silent switch mutes: a voice message played before anything else had
 * touched the session moved its progress bar in silence — it "only sometimes
 * worked". So the app sets playback once at start, and again after every
 * recording, voice or video.
 *
 * Recording is asked for right before a take and handed back right after it.
 * Both say `doNotMix`: a voice message pauses the person's music rather than
 * talking over it, and a take never records that music in the background.
 *
 * One rule follows from expo-audio itself: on iOS, playback mode stops every
 * running expo-audio recorder. So `playbackMode()` is only ever called once a
 * take has ended — never while one may still be running.
 *
 * Both are iOS only. On Android there is no session to set: the recorder never
 * asks whether recording is allowed, sound already plays whatever the ringer
 * says, and the focus a player asks for is the same either way. What setting a
 * mode does there is force the phone into its normal mode with the speakerphone
 * on — before every voice played, during someone's call in another app.
 */
const SESSION = Platform.OS === "ios";

/** Sound from the speaker, through the silent switch; nothing records. Never throws: a failure leaves the session as it was. */
export function playbackMode(): Promise<void> {
  if (!SESSION) return Promise.resolve();
  return setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: "doNotMix",
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);
}

/** The microphone on, sound still from the speaker. Throws when the phone refuses (a call, the microphone busy): the take must not start. */
export function recordingMode(): Promise<void> {
  if (!SESSION) return Promise.resolve();
  return setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    interruptionMode: "doNotMix",
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}
