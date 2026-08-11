import type { Metadata } from "next";

import { TariffCheckout } from "./TariffCheckout";

export const metadata: Metadata = {
  title: "Tarif — Jaxongirman",
  description: "Jaxongirman tarifini saytda faollashtiring.",
  robots: { index: false, follow: false },
};

/**
 * Buying a tariff on the web.
 *
 * The same order engine the apps use — no web-specific payment logic exists, so
 * a price or a commission cannot drift between platforms. Not indexed: this is a
 * transactional page, not something to find in a search result.
 */
export default function TariffPage() {
  return <TariffCheckout />;
}
