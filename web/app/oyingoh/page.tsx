import type { Metadata } from "next";

import { ArenaScreen } from "./ArenaScreen";

export const metadata: Metadata = {
  title: "O'yingoh — Jaxongirman",
  description: "Jaxongirman O'yingoh: katta ekranda bilim bellashuvi o'tkazing.",
};

/**
 * The projector's page.
 *
 * A browser here is signed out and stays that way: it opens an unclaimed match,
 * shows a rotating pairing code, and the phone that scans it becomes the only
 * device that can drive what happens next.
 */
export default function ArenaPage() {
  return <ArenaScreen />;
}
