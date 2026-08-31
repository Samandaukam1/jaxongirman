/**
 * Which engine builds a deck, and which way an unanswered question falls.
 *
 * The rule is four lines and it decides how every presentation the product
 * makes from now on looks, so it lives on its own where it can be read and
 * tested rather than inside the function that happens to run the query.
 *
 * The first version was `data?.value === true`, which is the natural thing to
 * write and quietly wrong: a row that was absent, filtered away by RLS, or lost
 * to a transport error all came back as "not true", and "not true" meant the
 * old template engine. So the engine could be switched off by a network blip,
 * silently, with the deck still shipping and nothing in the log to say which
 * engine had made it.
 *
 * Absence is not a vote. Only a `false` actually read back from the database —
 * an operator's deliberate choice, written to the audit log — turns one of
 * these off.
 */
export function engineSwitchOn(row: { value: unknown } | null | undefined, unreadable = false): boolean {
  if (unreadable || row == null) return true;
  return row.value !== false;
}

/** The keys the two switches live under in `app_settings`. */
export const DESIGN_SETTINGS = {
  generative: "design.generative_enabled",
  legacyRestricted: "design.legacy_restricted",
} as const;
