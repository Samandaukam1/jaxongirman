import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Jaxongirman — taqdimot, ma'lumot yig'ish va o'quv materiallari",
  description:
    "Jaxongirman: sun'iy intellekt bilan taqdimot yaratish, so'rovnoma orqali ma'lumot yig'ish va o'quv materiallari do'koni.",
  metadataBase: new URL("https://jaxongirman.uz"),
  openGraph: {
    title: "Jaxongirman",
    description: "Taqdimot yarating, ma'lumot yig'ing, materiallaringizni ulashing.",
    url: "https://jaxongirman.uz",
    siteName: "Jaxongirman",
    locale: "uz_UZ",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>
        <header className="site-header">
          <div className="shell">
            <a className="brand" href="/">
              <span className="brand-mark">J</span>
              Jaxongirman
            </a>
            <nav className="nav">
              <a href="/#imkoniyatlar">Imkoniyatlar</a>
              <a href="/dokon">Do&lsquo;kon</a>
              <a href="/taqdimot">Taqdimot qilish</a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="shell">
            <span>© {new Date().getFullYear()} Jaxongirman</span>
            <span>jaxongirman.uz</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
