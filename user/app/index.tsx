import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export default function Index() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return <Redirect href={session ? "/(app)" : "/(auth)/sign-in"} />;
}

const useStyles = makeStyles((colors) => ({ loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas } }));
