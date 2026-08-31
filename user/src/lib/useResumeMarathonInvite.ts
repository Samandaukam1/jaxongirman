import { useRouter } from "expo-router";
import { useEffect } from "react";

import { takeInvite } from "@/lib/marathon-link";

/**
 * Finishes a journey that started before there was an account.
 *
 * Somebody scans a candidate's QR with no app, installs it, signs up, and the
 * app they land in has no memory of why they opened it. The invitation was
 * written down by the deep-link route; this reads it back on the first screen
 * behind the sign-in gate and takes them to the vote sheet they were always
 * heading for.
 *
 * Read once and cleared in the same step, so a person who dismisses the sheet
 * is not sent back to it every time they open the app.
 */
export function useResumeMarathonInvite(active: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void takeInvite().then((invite) => {
      if (cancelled || !invite) return;
      router.push({
        pathname: "/(app)/marathon/vote",
        params: { campaignId: invite.campaignId, candidateId: invite.candidateId },
      });
    });
    return () => { cancelled = true; };
  }, [active, router]);
}
