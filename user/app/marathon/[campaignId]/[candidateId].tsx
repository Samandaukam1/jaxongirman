import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { rememberInvite } from "@/lib/marathon-link";
import { useAuth } from "@/providers/AuthProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The Universal Link / App Link target for `/marathon/<campaign>/<candidate>`.
 *
 * Deliberately outside `(app)`: a scanned code arrives before anybody has
 * signed in, and a route inside the authenticated area would be bounced to the
 * sign-in screen with the destination thrown away. So the invitation is written
 * down first, and only then does this hand over to the gate — a person who
 * scans a friend's QR, installs the app and makes an account lands on that
 * friend's vote sheet rather than on a home screen with no idea why they came.
 *
 * It draws a spinner rather than nothing: writing to storage is a tick or two,
 * and a blank screen in that gap reads as a link that did not work.
 */
export default function MarathonInviteScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { session, loading } = useAuth();
  const params = useLocalSearchParams<{ campaignId?: string; candidateId?: string }>();
  const campaignId = typeof params.campaignId === "string" ? params.campaignId : "";
  const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Nothing is written for somebody already signed in — they are one redirect
    // from the sheet, and a stored invitation nobody consumes would reopen it
    // the next time the app starts.
    if (loading) return;
    if (session || !campaignId || !candidateId) { setSettled(true); return; }
    void rememberInvite({ campaignId, candidateId }).finally(() => setSettled(true));
  }, [campaignId, candidateId, loading, session]);

  if (!settled || loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Signed in: straight to the sheet, and the stored copy is picked up and
  // cleared by the same hook that resumes one after a sign-up.
  if (session && campaignId && candidateId) {
    return <Redirect href={{ pathname: "/(app)/marathon/vote", params: { campaignId, candidateId } }} />;
  }
  return <Redirect href={session ? "/(app)" : "/(auth)/sign-in"} />;
}

const useStyles = makeStyles((colors) => ({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
}));
