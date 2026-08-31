import type { Metadata } from "next";

import { MarathonLanding } from "./MarathonLanding";

export const metadata: Metadata = {
  title: "Talabalar marafoni — Jaxongirman",
  description: "Jaxongirman Talabalar marafonida ishtirokchiga ovoz bering.",
  // A candidate's own link, printed on their own poster. Not a page to index.
  robots: { index: false, follow: false },
};

/**
 * `/marathon/<campaign>/<candidate>` — where a candidate's QR points.
 *
 * A phone with the app installed never renders this: the Universal Link / App
 * Link association hands the URL straight to Jaxongirman, which opens the vote
 * sheet on this candidate. This page is for everybody else, and its job is to
 * get them there — the right store button, and the same link waiting when they
 * come back.
 */
export default async function MarathonInvitePage({ params }: {
  params: Promise<{ campaignId: string; candidateId: string }>;
}) {
  const { campaignId, candidateId } = await params;
  return <MarathonLanding campaignId={campaignId} candidateId={candidateId} />;
}
