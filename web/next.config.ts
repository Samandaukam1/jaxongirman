import type { NextConfig } from "next";

/**
 * The public site, and the app beside it.
 *
 * The site explains the product, pairs a presentation with a phone, and signs a
 * browser in. Behind sign-in, the app itself runs at `/app`: the same screens
 * as the phone, exported for the browser into `public/app` by
 * `npm run build:webapp` (see user/app.config.js). Same origin on purpose — the
 * session the site writes is the session the app reads.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared types package is TypeScript source rather than a build artefact.
  transpilePackages: ["@jaxongirman/types", "@jaxongirman/slide-dom", "@jaxongirman/qr-video", "@jaxongirman/tariff-card"],

  async redirects() {
    // The account page grew into the app; its old address opens the app's profile.
    return [{ source: "/hisob", destination: "/app/profile", permanent: false }];
  },

  async rewrites() {
    // The app routes in the browser itself, so every address under /app that is
    // not one of its files is its single page. As a fallback, after the files
    // in public/app have been tried.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        { source: "/app", destination: "/app/index.html" },
        { source: "/app/:path*", destination: "/app/index.html" },
      ],
    };
  },

  async headers() {
    // Bundles and assets are named by their content hash, so they never change
    // under a name; the page that names them is always asked for afresh. When
    // two rules set one header the later wins, so the hashed files come last.
    const fresh = [
      { key: "Cache-Control", value: "no-cache" },
      { key: "X-Robots-Tag", value: "noindex" },
    ];
    const forever = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/app", headers: fresh },
      { source: "/app/:path*", headers: fresh },
      { source: "/app/_expo/:path*", headers: forever },
      { source: "/app/assets/:path*", headers: forever },
    ];
  },
};

export default nextConfig;
