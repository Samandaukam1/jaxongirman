import { Alert, Platform, Share } from "react-native";

import { i18n } from "@/i18n";

/**
 * The share sheet, in a browser.
 *
 * react-native-web's `Share.share` uses the Web Share API and rejects where
 * there is none — most desktop browsers — so "Ulashish" failed with an error a
 * person cannot act on. Here a browser with a share sheet still gets it; one
 * without copies the text and says so, which is what somebody at a desk was
 * going to do with a link anyway. Native keeps its own share sheet untouched.
 *
 * Imported once by the root layout, for its effect.
 */

if (Platform.OS === "web") {
  const shareInBrowser: typeof Share.share = async (content) => {
    const message = "message" in content ? content.message : undefined;
    const url = "url" in content ? content.url : undefined;
    const text = [message, url && !message?.includes(url) ? url : null].filter(Boolean).join("\n");

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: content.title, text: message, url });
        return { action: Share.sharedAction };
      } catch (failure) {
        if ((failure as { name?: string }).name === "AbortError") return { action: Share.dismissedAction };
        // Refused for another reason (no user gesture, an unsupported type): copy instead.
      }
    }
    await navigator.clipboard.writeText(text);
    Alert.alert(i18n.t("common:copied"), i18n.t("common:copiedBody"));
    return { action: Share.sharedAction };
  };
  Share.share = shareInBrowser;
}
