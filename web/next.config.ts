import type { NextConfig } from "next";

/**
 * The public site. Deliberately small: it exists to explain the product, to
 * pair a presentation with a phone, and to send people to the app — the
 * marketplace itself is an in-app service and is not rendered here.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared types package is TypeScript source rather than a build artefact.
  transpilePackages: ["@jaxongirman/types", "@jaxongirman/slide-dom", "@jaxongirman/qr-video", "@jaxongirman/tariff-card"],
};

export default nextConfig;
