import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";

/**
 * The Universal Link / App Link target for `https://<domain>/join/<token>`.
 *
 * A phone with the app installed never renders the web landing page: the OS
 * hands the URL here, and this route hands the token to the join screen so the
 * person lands on "pick a face, type a name" instead of a store button.
 *
 * It renders nothing on purpose — a visible frame would flash between the
 * camera closing and the join form opening.
 */
export default function JoinDeepLinkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";

  useEffect(() => {
    router.replace(token
      ? { pathname: "/(app)/oyingoh/join", params: { token } }
      : "/(app)/oyingoh/join");
  }, [router, token]);

  return null;
}
