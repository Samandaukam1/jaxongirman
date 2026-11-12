import type { Metadata } from "next";
import { ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";

import { LEGAL_DOCUMENTS, LEGAL_ENTITY } from "@/lib/company";
import { pageLanguage, sitePage, SITE_PAGE_SLUGS, type PageLanguage, type SitePageSlug } from "@/lib/site-pages";

import { Markdown } from "./Markdown";

/**
 * One legal page: its words from the database, in the reader's language.
 *
 * `?lang=en` (or `ru`, `uz`) picks the language; without it the browser's own
 * language decides, so App Review — reading in English — gets the English page
 * at the same URL the store holds.
 */

type Words = {
  updated: string; other: string; names: Record<SitePageSlug, string>; locale: string;
  operator: string; requisites: string; organisation: string; tin: string; address: string; email: string; phone: string;
  documentsNote: string; openPdf: string; verify: string;
};

const WORDS: Record<PageLanguage, Words> = {
  uz: {
    updated: "Yangilangan", other: "Boshqa sahifalar", locale: "uz-UZ",
    operator: `Jaxongirman — ${LEGAL_ENTITY.shortName} tasarrufidagi loyiha.`,
    requisites: "Tashkilot rekvizitlari va hujjatlari", organisation: "Tashkilot", tin: "STIR", address: "Manzil",
    email: "Email", phone: "Telefon", documentsNote: "", openPdf: "PDF faylni ochish", verify: "Davlat tizimida tekshirish",
    names: { privacy: "Maxfiylik siyosati", terms: "Foydalanish shartlari", support: "Yordam", "delete-account": "Akkauntni o‘chirish", refund: "Qaytarish siyosati" },
  },
  en: {
    updated: "Updated", other: "Other pages", locale: "en-US",
    operator: `Jaxongirman is a project operated by ${LEGAL_ENTITY.shortName.replace("MChJ", "LLC")}.`,
    requisites: "Operator details and documents", organisation: "Operator", tin: "Taxpayer ID (STIR)", address: "Address",
    email: "Email", phone: "Phone", documentsNote: "The documents are issued in Uzbek.", openPdf: "Open the PDF", verify: "Verify in the state registry",
    names: { privacy: "Privacy policy", terms: "Terms of use", support: "Support", "delete-account": "Delete your account", refund: "Refund policy" },
  },
  ru: {
    updated: "Обновлено", other: "Другие страницы", locale: "ru-RU",
    operator: `Jaxongirman — проект, находящийся в ведении ООО «MUKAMMAL MEDIA GROUP».`,
    requisites: "Реквизиты и документы организации", organisation: "Организация", tin: "ИНН (STIR)", address: "Адрес",
    email: "Email", phone: "Телефон", documentsNote: "Документы выданы на узбекском языке.", openPdf: "Открыть PDF", verify: "Проверить в госреестре",
    names: { privacy: "Политика конфиденциальности", terms: "Условия использования", support: "Поддержка", "delete-account": "Удаление аккаунта", refund: "Политика возврата" },
  },
};
const LANGUAGES: [PageLanguage, string][] = [["uz", "O‘zbekcha"], ["en", "English"], ["ru", "Русский"]];

/** The pages that are agreements or speak for the company carry its requisites and papers, as liderlar.uz's offer does. */
const WITH_DOCUMENTS: SitePageSlug[] = ["terms", "privacy", "refund"];

type Props = { searchParams: Promise<{ lang?: string }> };

/**
 * The page in the reader's language. A language guessed from the browser
 * that this page has no translation for falls back to Uzbek whole — never a
 * Russian frame around Uzbek words.
 */
async function resolve(slug: SitePageSlug, searchParams: Props["searchParams"]) {
  const { lang } = await searchParams;
  const { language, chosen } = pageLanguage(lang, (await headers()).get("accept-language"));
  const page = await sitePage(slug, language);
  if (page && !page.translated && !chosen) return { language: "uz" as PageLanguage, page: await sitePage(slug, "uz") };
  return { language, page };
}

export function legalMetadata(slug: SitePageSlug) {
  return async ({ searchParams }: Props): Promise<Metadata> => {
    const { language, page } = await resolve(slug, searchParams);
    return {
      title: `${page?.title ?? WORDS[language].names[slug]} — Jaxongirman`,
      alternates: { canonical: `/${slug}` },
    };
  };
}

export function legalPage(slug: SitePageSlug) {
  return async function LegalRoute({ searchParams }: Props) {
    const { language, page } = await resolve(slug, searchParams);
    if (!page) notFound();
    const words = WORDS[language];
    const updated = page.publishedAt
      ? new Date(page.publishedAt).toLocaleDateString(words.locale, { year: "numeric", month: "long", day: "numeric" })
      : null;

    return (
      <main className="legal-page" lang={language}>
        <div className="shell legal-shell">
          <nav className="legal-languages" aria-label="Til / Language">
            {LANGUAGES.map(([code, name]) => (
              <a key={code} href={`/${slug}?lang=${code}`} aria-current={code === language ? "true" : undefined}>{name}</a>
            ))}
          </nav>
          <header className="legal-head">
            <h1>{page.title}</h1>
            {updated ? <p>{words.updated}: {updated}</p> : null}
            <p className="legal-operator">{words.operator}</p>
          </header>
          <article className="legal-body">
            <Markdown source={page.body} />
          </article>
          {WITH_DOCUMENTS.includes(slug) ? <Requisites words={words} contacts={page.contacts} /> : null}
          <nav className="legal-others" aria-label={words.other}>
            <span>{words.other}</span>
            {SITE_PAGE_SLUGS.filter((other) => other !== slug).map((other) => (
              <a key={other} href={`/${other}${language === "uz" ? "" : `?lang=${language}`}`}>{words.names[other]}</a>
            ))}
          </nav>
        </div>
      </main>
    );
  };
}

/** The company behind the service, and the two documents that show it is registered and may publish. */
function Requisites({ words, contacts }: { words: Words; contacts: { email: string; phone: string } }) {
  const rows: [string, string][] = [
    [words.organisation, LEGAL_ENTITY.fullName],
    [words.tin, LEGAL_ENTITY.tin],
    [words.address, LEGAL_ENTITY.address],
    ...(contacts.email ? [[words.email, contacts.email] as [string, string]] : []),
    ...(contacts.phone ? [[words.phone, contacts.phone] as [string, string]] : []),
  ];
  return (
    <section className="legal-requisites" id="rekvizitlar" aria-labelledby="rekvizitlar-title">
      <h2 id="rekvizitlar-title">{words.requisites}</h2>
      <dl className="legal-facts">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {words.documentsNote ? <p className="legal-note">{words.documentsNote}</p> : null}
      {LEGAL_DOCUMENTS.map((document) => (
        <article className="legal-doc" id={document.id} key={document.id}>
          <a className="legal-doc-preview" href={document.pdfHref} target="_blank" rel="noopener">
            <Image src={document.previewSrc} alt={document.title} width={document.previewWidth} height={document.previewHeight} sizes="240px" />
            <span><FileText aria-hidden />{words.openPdf}</span>
          </a>
          <div className="legal-doc-body">
            <p className="legal-doc-eyebrow">{document.eyebrow}</p>
            <h3>{document.title}</h3>
            <dl className="legal-facts">
              {document.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
            <p className="legal-doc-status">
              <ShieldCheck aria-hidden />
              <span>{document.verification.text} <strong>“{document.verification.status}”</strong>.</span>
            </p>
            <a className="legal-doc-verify" href={document.verification.href} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />{words.verify}
            </a>
          </div>
        </article>
      ))}
    </section>
  );
}
