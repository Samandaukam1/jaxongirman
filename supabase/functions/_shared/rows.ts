/**
 * Every row a query matches, not only the first thousand.
 *
 * The REST API answers at most `max_rows` (1000) rows per request, silently.
 * A twenty-page deck in some styles is more than a thousand elements, and the
 * rows cut off were the top layers — the words — so a long deck exported,
 * projected and scripted with pages missing their text. Pages of exactly the
 * API's size are read in order until one comes back short. The query must be
 * ordered by something unique for the pages not to overlap.
 */
export const PAGE_ROWS = 1000;

export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return rows;
  }
}
