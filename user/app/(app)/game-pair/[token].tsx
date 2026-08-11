import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";

/**
 * The deep-link target for `jaxongirman://game-pair/<token>`.
 *
 * Its own path rather than the presentation `pair/` one, because a code scanned
 * with the phone's own camera app carries nothing but a string: if both QRs used
 * the same scheme, a game code would arrive at the presentation claim and fail
 * for a reason nobody could act on.
 *
 * Renders nothing — the host scanner does the claiming, and a visible frame here
 * would only flash.
 */
export default function GamePairDeepLinkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";

  useEffect(() => {
    router.replace(token
      ? { pathname: "/(app)/oyingoh/scan", params: { token } }
      : "/(app)/oyingoh/scan");
  }, [router, token]);

  return null;
}
