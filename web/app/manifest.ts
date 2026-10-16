import type { MetadataRoute } from "next";

import { loadBranding } from "@/lib/branding";

/** What a phone installs when the site is added to a home screen. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await loadBranding();
  return {
    name: "Jaxongirman",
    short_name: "Jaxongirman",
    description: "Sun’iy intellekt bilan taqdimot yarating va telefoningizdan boshqaring.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#6C34C9",
    icons: [
      { src: brand.app, sizes: "512x512", purpose: "any" },
      { src: brand.apple, sizes: "180x180" },
    ],
  };
}
