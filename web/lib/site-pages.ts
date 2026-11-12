import { unstable_cache } from "next/cache";

import { LEGAL_ENTITY } from "./company";
import { fillPlaceholders, type PageLanguage } from "./legal-text";

export { pageLanguage, type PageLanguage } from "./legal-text";

/**
 * The legal pages: /privacy, /terms, /support, /delete-account, /refund.
 *
 * App Store Connect and Google Play each hold one of these URLs, so the pages
 * read their words from the database (`site_pages`, edited and published from
 * the console, 202610200002) and are never compiled into the site. Only the
 * published row is readable signed out; a draft cannot reach a store's URL.
 *
 * Uzbek is every page's source (`title`/`body`); English and Russian sit in
 * `*_i18n`, and an empty translation shows the Uzbek. Contact details are one
 * setting, `site.contacts`, quoted through `{{support_email}}` and friends; a
 * line whose value is empty is left off the page rather than shown with a
 * placeholder in it.
 */

export const SITE_PAGE_SLUGS = ["privacy", "terms", "support", "delete-account", "refund"] as const;
export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];

type I18n = Partial<Record<"en" | "ru", string>>;
type PageRow = { slug: string; title: string; body: string; title_i18n: I18n | null; body_i18n: I18n | null; version: number; published_at: string | null };
type Contacts = Partial<Record<"company_name" | "stir" | "address" | "support_email" | "phone" | "telegram", string>>;
type RefundPolicy = { title?: string; body?: string; i18n?: Partial<Record<"en" | "ru", { title?: string; body?: string }>> };

export type SitePage = {
  title: string; body: string; version: number; publishedAt: string | null;
  contacts: { email: string; phone: string };
  /** False when the page has no text of its own in this language and shows the Uzbek. */
  translated: boolean;
};

async function rest<T>(path: string): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  try {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The published row and the public settings its placeholders quote, cached for two minutes. */
const loadPage = unstable_cache(
  async (slug: SitePageSlug) => {
    const [pages, settings] = await Promise.all([
      rest<PageRow[]>(`site_pages?slug=eq.${encodeURIComponent(slug)}&select=slug,title,body,title_i18n,body_i18n,version,published_at`),
      rest<{ key: string; value: unknown }[]>(
        "app_settings?key=in.(site.contacts,marketplace.refund_policy,modules.data_collection)&select=key,value",
      ),
    ]);
    const setting = (key: string) => settings?.find((row) => row.key === key)?.value ?? null;
    return {
      page: pages?.[0] ?? null,
      contacts: (setting("site.contacts") ?? {}) as Contacts,
      refund: (setting("marketplace.refund_policy") ?? {}) as RefundPolicy,
      retentionHours: (setting("modules.data_collection") as { response_retention_hours?: number } | null)?.response_retention_hours ?? 48,
    };
  },
  ["site-page"],
  { revalidate: 120 },
);

function telegramUrl(handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle;
  return `https://t.me/${handle.replace(/^@/, "")}`;
}

export async function sitePage(slug: SitePageSlug, language: PageLanguage): Promise<SitePage | null> {
  const { page, contacts, refund, retentionHours } = await loadPage(slug);
  if (!page) return null;

  const translated = (source: string, i18n: I18n | null) =>
    language === "uz" ? source : (i18n?.[language]?.trim() ? i18n[language]! : source);
  const refundWords = language === "uz" ? refund : { ...refund, ...(refund.i18n?.[language] ?? {}) };
  const refundText = [refundWords.title ? `### ${refundWords.title}` : "", refundWords.body ?? ""].filter(Boolean).join("\n\n");

  const telegram = contacts.telegram?.trim() ?? "";
  const values: Record<string, string> = {
    // The registered company's own requisites unless the console has set others.
    company_name: contacts.company_name?.trim() || LEGAL_ENTITY.shortName,
    stir: contacts.stir?.trim() || LEGAL_ENTITY.tin,
    address: contacts.address?.trim() || LEGAL_ENTITY.address,
    support_email: contacts.support_email ?? "",
    phone: contacts.phone ?? "",
    telegram,
    telegram_url: telegram ? telegramUrl(telegram) : "",
    survey_retention_hours: String(retentionHours),
    refund_policy: refundText,
  };

  return {
    title: translated(page.title, page.title_i18n),
    body: fillPlaceholders(translated(page.body, page.body_i18n), values),
    version: page.version,
    publishedAt: page.published_at,
    contacts: { email: values.support_email!, phone: values.phone! },
    translated: language === "uz" || Boolean(page.body_i18n?.[language]?.trim()),
  };
}
