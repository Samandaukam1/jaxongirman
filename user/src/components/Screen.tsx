import type { PropsWithChildren } from "react";
import { ScrollView, View, type ScrollViewProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { spacing } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

type Props = PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: ViewStyle;
  scrollProps?: ScrollViewProps;
}>;

export function Screen({ children, scroll = false, contentStyle, scrollProps }: Props) {
  const styles = useStyles();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, contentStyle]}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing.xl },
}));
