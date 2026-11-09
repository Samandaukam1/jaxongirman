import type { Metadata } from "next";

import { ArenaScreen } from "../../ArenaScreen";

export const metadata: Metadata = {
  title: "O'yingoh ekrani — Jaxongirman",
  description: "Jaxongirman O'yingoh bellashuvi katta ekranda.",
  // One host's live match, readable only by that host. Nothing to index.
  robots: { index: false, follow: false },
};

/**
 * `/oyingoh/ekran/<sessionId>` — the big screen of a match started on this
 * computer.
 *
 * The web app's host remote shows it beside its controls, and opens it in a
 * window of its own for a projector. Same origin as the app, so the browser is
 * already signed in as the host, and that is what lets it read the match: no
 * pairing code, no screen token.
 */
export default async function HostArenaPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ArenaScreen hostSessionId={sessionId} />;
}
