import type { Metadata } from "next";

import { PairingScreen } from "./PairingScreen";

export const metadata: Metadata = {
  title: "Taqdimot qilish — Jaxongirman",
  description: "Telefoningizni pultga aylantiring: ekrandagi QR kodni skaner qiling.",
};

export default function PairingPage() {
  return <PairingScreen />;
}
