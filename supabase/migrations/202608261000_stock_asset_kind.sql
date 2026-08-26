/**
 * A found photograph is a kind of asset the enum never had a name for.
 *
 * `pipeline.ts` has written `kind: 'stock'` for every licensed photograph it
 * found, and `asset_kind` has only ever held upload, web, generated, icon,
 * thumbnail and export. So the insert failed — silently, because nothing read
 * the result — and the photograph was stored in the bucket while the row
 * carrying its photographer, its licence and its link back was thrown away.
 *
 * That is a licence problem rather than a tidiness one. Openverse results are
 * CC-BY and Unsplash's terms require the photographer credited; provenance that
 * was never recorded cannot be recovered from the file afterwards.
 *
 * Additive: adding a value to an enum takes no lock on the data and cannot
 * invalidate a row that already exists.
 */
alter type public.asset_kind add value if not exists 'stock';
