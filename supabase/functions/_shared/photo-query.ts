/**
 * What to ask a photo index for.
 *
 * Separated from the provider because the provider does network and storage,
 * and this is the part worth testing: a query built out of style words returns
 * pictures of clay and studio lighting rather than of the subject.
 */

/**
 * Turns a slide's visual direction into something a photo index can answer.
 *
 * An image model takes a paragraph; a search takes nouns. The direction written
 * for a generator — "isolated 3D clay render of a neural network, soft contact
 * shadow" — describes a style nothing in an index is tagged with, so the style
 * words are dropped and what is left is the subject.
 */
export function photoQuery(direction: string, topic: string): string {
  const STYLE_WORDS = new Set([
    "3d", "render", "clay", "isolated", "matte", "soft", "shadow", "cgi",
    "illustration", "vector", "flat", "minimal", "editorial", "photography",
    "photo", "background", "backdrop", "negative", "space", "composition",
    "lighting", "studio", "closeup", "close-up", "shot", "style", "modern",
    "professional", "high", "quality", "detailed", "realistic",
  ]);

  const words = direction
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STYLE_WORDS.has(word));

  const subject = words.slice(0, 4).join(" ").trim();
  // A direction that was nothing but style words leaves the topic, which is at
  // least about the right thing.
  return subject.length >= 3 ? subject : topic.split(/\s+/).slice(0, 4).join(" ");
}
