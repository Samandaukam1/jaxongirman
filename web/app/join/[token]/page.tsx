import type { Metadata } from "next";

import { JoinLanding } from "./JoinLanding";

export const metadata: Metadata = {
  title: "O'yinga qo'shilish — Jaxongirman O'yingoh",
  description: "Jaxongirman O'yingoh bellashuviga qo'shiling.",
  // A join link is single-use and belongs to one room. Nothing to index.
  robots: { index: false, follow: false },
};

/**
 * `/join/<token>` — the universal link the projector's QR carries.
 *
 * On a phone with the app installed the OS never renders this: the Universal
 * Link / App Link association hands the URL straight to Jaxongirman. This page
 * is what everyone else sees, and it is deliberately useful on its own — the
 * join code is printed here, so a person with no app and no patience can still
 * type six digits and play.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinLanding token={token} />;
}
