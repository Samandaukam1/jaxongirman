import { supabase } from "@/lib/supabase";

/**
 * Asking the resolver what picture a query gets, and why.
 *
 * The console never searches anything itself. It asks the same function the
 * generator asks, so what an administrator sees here is what a customer's deck
 * will get — including the refusals, which are the part worth looking at.
 */

export type ResolvedImage = {
  status: "verified" | "found" | "no_image";
  intent: string;
  entity: string;
  normalized: string;
  provider: string | null;
  confidence: number;
  reason: string | null;
  storagePath: string | null;
  trace: Array<{ step: string; detail?: string }>;
  hit: {
    url: string;
    width: number;
    height: number;
    attribution: { title: string; creator: string; license: string; licenseUrl: string; sourceUrl: string; provider: string };
  } | null;
};

export type Candidate = ResolvedImage["hit"] & { provider: string };

export type CandidateList = {
  intent: string;
  entity: string;
  normalized: string;
  orientation: string;
  candidates: Candidate[];
  note: string | null;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("image-resolver", { body });
  if (!error) return data as T;

  // The function's refusals are answers — a query that is too long, a caller
  // who is not an admin. `invoke` turns every non-2xx into one generic
  // sentence, which is the one thing that does not help.
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    try {
      const detail = await (context as Response).json();
      if (detail && typeof detail === "object" && "error" in detail) {
        throw new Error(String((detail as { error: unknown }).error));
      }
    } catch (readError) {
      if (readError instanceof Error && readError.message) throw readError;
    }
  }
  throw error;
}

export const resolveBest = (input: Record<string, unknown>) =>
  call<ResolvedImage>({ ...input, mode: "best" });

export const resolveCandidates = (input: Record<string, unknown>) =>
  call<CandidateList>({ ...input, mode: "candidates" });

export type VerifiedRow = {
  id: string;
  normalized_entity: string;
  display_name: string;
  entity_type: string;
  provider: string;
  source_url: string | null;
  creator: string | null;
  license: string | null;
  verified_at: string | null;
};

export async function listVerified(): Promise<VerifiedRow[]> {
  const { data, error } = await supabase
    .from("verified_images")
    .select("id, normalized_entity, display_name, entity_type, provider, source_url, creator, license, verified_at")
    .eq("verified", true)
    .order("verified_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as VerifiedRow[];
}

/**
 * Confirming a picture is of the thing it claims to be.
 *
 * Through the RPC rather than a table write: the check that the caller is an
 * administrator lives beside the write, where it cannot be forgotten, and
 * confirming the same subject twice updates the row instead of failing.
 */
export async function verifyImage(input: {
  normalized: string;
  displayName: string;
  entityType: string;
  storagePath: string;
  provider: string;
  originalUrl?: string | null;
  sourceUrl?: string | null;
  creator?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("verify_image", {
    p_normalized_entity: input.normalized,
    p_display_name: input.displayName,
    p_entity_type: input.entityType,
    p_storage_path: input.storagePath,
    p_provider: input.provider,
    // Omitted rather than nulled: the generated signature takes `undefined`
    // for an argument left out, and Postgres applies the default either way.
    p_original_url: input.originalUrl ?? undefined,
    p_source_url: input.sourceUrl ?? undefined,
    p_creator: input.creator ?? undefined,
    p_license: input.license ?? undefined,
    p_license_url: input.licenseUrl ?? undefined,
  });
  if (error) throw error;
}
