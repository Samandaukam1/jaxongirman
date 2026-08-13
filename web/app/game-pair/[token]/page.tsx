import type { Metadata } from "next";

import { ScanLanding } from "@/app/_qr/ScanLanding";

export const metadata: Metadata = {
  title: "O'yingoh boshqaruvi — Jaxongirman",
  description: "Jaxongirman O'yingoh bellashuvini telefoningizdan olib boring.",
  // A pairing code is single-use and belongs to one screen. Nothing to index.
  robots: { index: false, follow: false },
};

/**
 * `/game-pair/<token>` — the universal link the arena's QR carries.
 *
 * The host's code, not a player's: scanning it is what binds the match on the
 * big screen to the phone that will run it. Players have `/join/<token>`.
 */
export default async function GamePairPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ScanLanding token={token} kind="game-pair" />;
}
