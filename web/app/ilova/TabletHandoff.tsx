"use client";

import { useEffect } from "react";

import { STORE_IOS } from "@/lib/stores";

/**
 * An iPad, which the server cannot tell from a Mac.
 *
 * iPadOS asks for desktop pages and reports itself as a Macintosh, so it arrives
 * at the computer's page. Only the browser can see the touch screen behind that
 * name, so this one case is decided here.
 */
export function TabletHandoff() {
  useEffect(() => {
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) window.location.replace(STORE_IOS);
  }, []);

  return null;
}
