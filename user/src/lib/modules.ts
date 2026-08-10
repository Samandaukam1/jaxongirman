import { DATA_COLLECTION_MODULE, type ModuleAccessState } from "@jaxongirman/types";
import { useCallback, useEffect, useState } from "react";

import { asErrorMessage } from "./format";
import { supabase } from "./supabase";

/**
 * The truth about a module's availability, straight from the server.
 *
 * Deliberately not cached across mounts: access can be granted or revoked by an
 * admin while the app is open, and a screen that gates on stale state would
 * either lock someone out of what they just bought or let them start work the
 * server will refuse to save.
 */
export function useModuleAccess(moduleCode: string = DATA_COLLECTION_MODULE) {
  const [state, setState] = useState<ModuleAccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: requestError } = await supabase.rpc("module_access_state", { p_module_code: moduleCode });
    if (requestError) {
      setError(asErrorMessage(requestError));
    } else {
      setState(data as unknown as ModuleAccessState);
      setError(null);
    }
    setLoading(false);
  }, [moduleCode]);

  useEffect(() => { void reload(); }, [reload]);

  return { state, loading, error, reload };
}

/**
 * Whether this person may act on the module right now, and why not when they
 * may not. Mirrors `assert_module_access()` so the UI and the server agree on
 * who is blocked — the server still decides.
 */
export function moduleGate(state: ModuleAccessState | null, role: "creator" | "respondent") {
  if (!state) return { allowed: true, reason: null as string | null };
  if (!state.enabled) return { allowed: false, reason: "Modul vaqtincha o‘chirilgan." };
  const enforced = role === "creator" ? state.enforce_creator_access : state.enforce_respondent_access;
  if (enforced && !state.has_access) {
    return {
      allowed: false,
      reason: role === "creator"
        ? "So‘rovnoma yaratish uchun modulga kirish huquqi kerak."
        : "So‘rovnomaga javob berish uchun modulga kirish huquqi kerak.",
    };
  }
  return { allowed: true, reason: null };
}
