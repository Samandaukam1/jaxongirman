import type { Metadata } from "next";

import { AccountScreen } from "./AccountScreen";

export const metadata: Metadata = {
  title: "Hisobim — Jaxongirman",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountScreen />;
}
