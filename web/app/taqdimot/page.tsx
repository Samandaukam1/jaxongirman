import type { Metadata } from "next";

import { loadQrExperienceRow } from "@/lib/qr-experience";

import { PairingScreen } from "./PairingScreen";

export const metadata: Metadata = {
  title: "Taqdimot qilish — Jaxongirman",
  description: "Telefoningizni pultga aylantiring: ekrandagi QR kodni skaner qiling.",
};

/**
 * Rendered per request, because what this screen shows is a decision an admin
 * can change at any moment — and because the alternative is deciding it in the
 * browser, which showed the old pairing card for a beat before the film
 * replaced it.
 */
export const dynamic = "force-dynamic";

export default async function PairingPage() {
  return <PairingScreen experienceRow={await loadQrExperienceRow("taqdimot")} />;
}
