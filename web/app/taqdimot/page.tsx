import type { Metadata } from "next";
import { headers } from "next/headers";

import { isPhone } from "@/lib/device";
import { loadQrExperienceRow } from "@/lib/qr-experience";

import { PairingScreen } from "./PairingScreen";
import { PhoneNotice } from "./PhoneNotice";

export const metadata: Metadata = {
  title: "Taqdimot qilish — Jaxongirman",
  description: "Telefoningizni pultga aylantiring: ekrandagi QR kodni skaner qiling.",
};

/**
 * Rendered per request, because what this screen shows is a decision an admin
 * can change at any moment — and because the alternative is deciding it in the
 * browser, which showed the old pairing card for a beat before the film
 * replaced it. The same goes for a phone: it is told so before anything is
 * drawn, and no session is opened for a screen that cannot be scanned.
 *
 * A phone asking for desktop sites says it is a computer, so it reaches the
 * pairing screen, which tells it by its screen instead (`lib/device.ts`). The
 * wrapper is what `phone-notice.css` hides until then.
 */
export const dynamic = "force-dynamic";

export default async function PairingPage() {
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (isPhone(userAgent)) return <PhoneNotice android={/android/i.test(userAgent)} />;
  return (
    <div className="tq-pairing">
      <PairingScreen experienceRow={await loadQrExperienceRow("taqdimot")} />
    </div>
  );
}
