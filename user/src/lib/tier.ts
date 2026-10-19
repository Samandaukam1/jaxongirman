/**
 * What a plan looks like when somebody is on it.
 *
 * A paying member's profile should not look like a free one with a word added.
 * Each paid plan is a metal — OSON bronze, MAZZA silver, BEMALOL and the old
 * monthly Premium gold — and the metal is the rim of the profile card, its
 * badge, the seal by the name and the light that crosses the card. Without a
 * plan the card wears the brand's violet and nothing shines.
 *
 * Keyed by plan code, because the code is what the database guarantees; a plan
 * an operator adds later without a metal of its own is drawn as silver.
 */
export type Tier = "free" | "bronze" | "silver" | "gold";

const BY_PLAN: Record<string, Tier> = {
  oson: "bronze",
  mazza: "silver",
  bemalol: "gold",
  premium_monthly: "gold",
};

export function tierOf(planCode: string | null | undefined, member: boolean): Tier {
  if (!member) return "free";
  return (planCode && BY_PLAN[planCode]) || "silver";
}

export type TierLook = {
  /** The metal, light to dark: a rim, a badge, a seal. */
  metal: readonly [string, string, string];
  /** Ink laid on the metal. */
  onMetal: string;
  /** The colour the card's light and glow take. */
  glow: string;
  /** The wash over the bottom of the photograph, under the name. */
  shade: readonly [string, string];
  /** The deep tone the photograph melts into under the text, as a solid. */
  deep: string;
  /** Whether a band of light crosses the card. */
  shines: boolean;
};

export const TIER_LOOK: Record<Tier, TierLook> = {
  free: {
    deep: "#1A0A3C",
    metal: ["#B794F6", "#7C4DDB", "#4B1FA8"],
    onMetal: "#FFFFFF",
    glow: "#7C4DDB",
    shade: ["rgba(26,10,60,0)", "rgba(26,10,60,0.88)"],
    shines: false,
  },
  bronze: {
    deep: "#2A1309",
    metal: ["#FFD9B8", "#C9834C", "#7A4320"],
    onMetal: "#3B1D07",
    glow: "#E0965A",
    shade: ["rgba(40,18,6,0)", "rgba(40,18,6,0.86)"],
    shines: true,
  },
  silver: {
    deep: "#121720",
    metal: ["#FFFFFF", "#C3CBD6", "#6B7480"],
    onMetal: "#1F2630",
    glow: "#C9D3E0",
    shade: ["rgba(16,20,28,0)", "rgba(16,20,28,0.86)"],
    shines: true,
  },
  gold: {
    deep: "#251703",
    metal: ["#FFF1C1", "#E6B53E", "#9C6A0E"],
    onMetal: "#3A2304",
    glow: "#F2C14E",
    shade: ["rgba(36,22,2,0)", "rgba(36,22,2,0.86)"],
    shines: true,
  },
};
