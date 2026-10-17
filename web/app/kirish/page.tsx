import type { Metadata } from "next";

import { loadQrExperienceRow } from "@/lib/qr-experience";

import { SignInScreen } from "./SignInScreen";

export const metadata: Metadata = {
  title: "Hisobga kirish — Jaxongirman",
  description: "Jaxongirman ilovasi bilan QR kodni skaner qilib, saytda hisobingizga kiring.",
  robots: { index: false, follow: false },
};

/**
 * Per request, like the presenting screen: the film is an admin's choice that
 * can change at any moment, and it should be the first paint, not a swap.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  return <SignInScreen experienceRow={await loadQrExperienceRow("taqdimot")} />;
}
