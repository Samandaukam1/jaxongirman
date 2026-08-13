import type { Metadata } from "next";

import { ScanLanding } from "@/app/_qr/ScanLanding";

export const metadata: Metadata = {
  title: "Taqdimot pulti — Jaxongirman",
  description: "Jaxongirman taqdimotini telefoningizdan boshqaring.",
  // A pairing code is single-use and belongs to one screen. Nothing to index.
  robots: { index: false, follow: false },
};

/**
 * `/pair/<token>` — the universal link the projector's QR carries.
 *
 * On a phone with the app installed the OS never renders this: the association
 * hands the URL straight to Jaxongirman, which claims the code and takes over
 * the screen. This page is what everyone else sees.
 */
export default async function PairPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ScanLanding token={token} kind="pair" />;
}
