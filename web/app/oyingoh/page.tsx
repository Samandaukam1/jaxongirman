import type { Metadata } from "next";

import { loadQrExperienceRow } from "@/lib/qr-experience";

import { ArenaScreen } from "./ArenaScreen";

export const metadata: Metadata = {
  title: "O'yingoh — Jaxongirman",
  description: "Jaxongirman O'yingoh: katta ekranda bilim bellashuvi o'tkazing.",
};

/** Per request, for the same reason as the remote's screen. */
export const dynamic = "force-dynamic";

/**
 * The projector's page.
 *
 * A browser here is signed out and stays that way: it opens an unclaimed match,
 * shows a rotating pairing code, and the phone that scans it becomes the only
 * device that can drive what happens next.
 */
export default async function ArenaPage() {
  return <ArenaScreen experienceRow={await loadQrExperienceRow("oyingoh")} />;
}
