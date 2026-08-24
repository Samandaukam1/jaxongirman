/**
 * Turning a palette colour into a wash.
 *
 * A tint that identifies something — the hue of a tool's artwork bleeding onto
 * the card under it — is only ever wanted at a few percent, and a palette that
 * carried every colour at every alpha it might be needed at would be a hundred
 * entries long. So the hue is stated once, as a solid, and the places that want
 * it faint ask for it faint here.
 *
 * The slide renderer keeps its own copy of this (`lib/slideStyle`, mirrored in
 * `packages/slide-dom`) on purpose: those two paint the same slide on two
 * platforms and have to stay in lockstep with each other, not with the app's
 * chrome.
 */
export function withAlpha(hex: string, opacity: number): string {
  const body = hex.replace("#", "");
  const expanded = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
  const channel = (start: number) => Number.parseInt(expanded.slice(start, start + 2), 16) || 0;
  const base = expanded.length >= 8 ? channel(6) / 255 : 1;
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${Math.min(1, Math.max(0, opacity * base))})`;
}

/**
 * The same wash, mixed down to a solid.
 *
 * A translucent colour needs something behind it, and a card's own
 * `backgroundColor` has nothing behind it but the canvas — set it to an rgba
 * and the card goes see-through rather than tinted. Where a tint has to be the
 * background itself, this mixes it into the ground it would have sat on and
 * hands back an opaque colour.
 */
export function blend(base: string, top: string, amount: number): string {
  const read = (hex: string) => {
    const body = hex.replace("#", "");
    const full = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
    return [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16) || 0);
  };
  const ground = read(base);
  const wash = read(top);
  const share = Math.min(1, Math.max(0, amount));
  const mix = ground.map((channel, index) => Math.round(channel + ((wash[index] ?? channel) - channel) * share));
  return `#${mix.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
