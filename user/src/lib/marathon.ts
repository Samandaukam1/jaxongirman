import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * Whether the student marathon is showing.
 *
 * One switch, read from the settings table the operator controls, and false
 * until it says otherwise. Everything the marathon adds to the app — five
 * entry points, a poster, a section on the profile — is drawn only when this
 * answers true, so the feature can sit finished and invisible for as long as
 * we like.
 *
 * The default matters more than the query: a screen that waits for this before
 * drawing anything is a screen that stays blank if the answer never arrives.
 * It starts closed and opens when told.
 */
export function useMarathonEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("app_settings")
      .select("value")
      .eq("key", "student_marathon_enabled")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setEnabled(data?.value === true);
      });
    return () => { cancelled = true; };
  }, []);

  return enabled;
}
