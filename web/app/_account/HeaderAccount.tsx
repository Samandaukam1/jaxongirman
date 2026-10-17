"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * The account link in the header: "Hisobga kirish" for a visitor, "Ilovani
 * ochish" — the web app at /app — once this browser is signed in. Rendered
 * empty until the session is read, so the wrong word never flashes.
 */
export function HeaderAccount() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => { if (alive) setSignedIn(Boolean(data.session)); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  if (signedIn === null) return <span className="header-account is-pending" aria-hidden />;
  return (
    <a className="header-account" href={signedIn ? "/app" : "/kirish"}>
      {signedIn ? "Ilovani ochish" : "Hisobga kirish"}
    </a>
  );
}
