import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  candidateLink as buildLink, linkHost, PENDING_KEY, readStoredInvite, type MarathonInvite,
} from "@/lib/marathon-link-core";

export { parseInviteUrl, shareMessage, type MarathonInvite } from "@/lib/marathon-link-core";

/**
 * The host is read here rather than in the core, so the decisions in the core
 * can be compiled and tested on their own — the app is the only part of this
 * that has an environment.
 */
export function candidateLink(campaignId: string, candidateId: string): string {
  return buildLink(campaignId, candidateId, linkHost(process.env.EXPO_PUBLIC_APP_URL));
}

/**
 * Remembers where somebody was heading before they were asked to sign in.
 *
 * The deep link lands before there is a session, and the sign-in redirect
 * throws the destination away. Without this, scanning a friend's QR and making
 * an account drops you on the home screen with no idea who you came to
 * support — which is the one thing §18 asks not to happen.
 */
export async function rememberInvite(invite: MarathonInvite): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ ...invite, at: Date.now() }));
  } catch {
    // A device that cannot write it still opens the vote screen if signed in.
  }
}

/** Reads the pending invitation and forgets it, so it is acted on exactly once. */
export async function takeInvite(): Promise<MarathonInvite | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (raw) await AsyncStorage.removeItem(PENDING_KEY);
    return readStoredInvite(raw);
  } catch {
    return null;
  }
}
