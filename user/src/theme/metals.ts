import { TIER_LOOK, tierOf } from "@/lib/tier";
import { withAlpha } from "@/theme/color";

/**
 * Bronze, silver and gold on the tariff screen — the same metals the profile
 * card wears (`TIER_LOOK`), so a plan is one colour wherever it appears.
 *
 * `face` is the metal light to dark, for the medal, the price tag and the
 * button; `ink` is the text laid on it; `rim` is the line colour used against
 * the app's own surfaces (the edge, the cord, the ticks), taken between the
 * metal's body and its edge so it still reads on white; `glow` is the halo
 * and the button's shadow.
 */

export type MetalName = "bronze" | "silver" | "gold";

export type Metal = {
  name: MetalName;
  face: readonly [string, string, string];
  rim: string;
  ink: string;
  glow: string;
};

/** Halfway between two `#rrggbb` colours. */
function between(left: string, right: string): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  const mixed = [1, 3, 5].map((at) => Math.round((channel(left, at) + channel(right, at)) / 2));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function metalOf(name: MetalName): Metal {
  const look = TIER_LOOK[name];
  return { name, face: look.metal, rim: between(look.metal[1], look.metal[2]), ink: look.onMetal, glow: withAlpha(look.glow, 0.42) };
}

export const metals: Record<MetalName, Metal> = {
  bronze: metalOf("bronze"),
  silver: metalOf("silver"),
  gold: metalOf("gold"),
};

/** Each plan's metal, by code — the rule the profile card uses (`tierOf`). */
export function metalsOf(plans: readonly { code: string }[]): Map<string, Metal> {
  const map = new Map<string, Metal>();
  for (const plan of plans) {
    const tier = tierOf(plan.code, true);
    map.set(plan.code, metals[tier === "free" ? "silver" : tier]);
  }
  return map;
}
