import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Gamepad2, House, Layers, Store, User, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, UIManager, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { profileInitials, useAccount } from "@/providers/AccountProvider";
import { spacing } from "@/theme/tokens";
import type { Palette } from "@/theme/palettes";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Only the parts of the tab bar contract this bar actually uses. Typed here
 * rather than imported from a navigator's internals, so a version bump cannot
 * break the build over a path.
 */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  };
};

const LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: "Bosh sahifa", icon: House },
  projects: { label: "Loyihalar", icon: Layers },
  marketplace: { label: "Do‘kon", icon: Store },
  games: { label: "O‘yinlar", icon: Gamepad2 },
  profile: { label: "Profil", icon: User },
};

const BAR_INSET = spacing.lg;
const ITEM_HEIGHT = 58;
/** Equal breathing room above and below the row of items. */
const BAR_PAD_V = 7;
const BAR_HEIGHT = ITEM_HEIGHT + BAR_PAD_V * 2;
/** One size for every glyph, selected or not. */
const ICON_SIZE = 28;
/** How far the selected glyph rises to make room for its label. */
const ICON_LIFT = 6;
/** A true capsule. */
const BAR_RADIUS = BAR_HEIGHT / 2;
/** Keeps the selected pill off the capsule's own edge on the first and last tab. */
const INDICATOR_INSET = 6;

/** Room the floating bar needs at the bottom of a scrolling screen. */
export const BOTTOM_NAV_SPACE = 104;

/**
 * Whether the blur view is actually in this binary.
 *
 * `expo-blur` is native, so a JS-only reload after installing it leaves
 * `<BlurView>` rendering React Native's red "Unimplemented component" box — which
 * would replace the whole tab bar with an error until the app is rebuilt. Asking
 * the module registry costs nothing, and the glass below is layered so that the
 * blur is an enhancement rather than the thing holding the surface together.
 */
const BLUR_LINKED = (() => {
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  if (registry) return "ExpoBlur" in registry;
  return UIManager.hasViewManagerConfig?.("ExpoBlurView") ?? false;
})();

/**
 * The glass itself: a bright top sheen falling to a faintly violet base.
 *
 * Over a live blur these stay translucent enough to let the page read through.
 * Without one they close up and carry the surface alone — the same material,
 * one layer thinner.
 */
const sheenOf = (colors: Palette): readonly [string, string, string] =>
  (BLUR_LINKED ? colors.glassSheen : colors.glassSheenOpaque);

/** One spring, so the indicator and every icon move as a single mechanism. */
const SPRING = { damping: 20, stiffness: 210, mass: 0.6 } as const;
const FADE = { duration: 190, easing: Easing.out(Easing.quad) } as const;

type ItemProps = {
  label: string;
  icon: LucideIcon;
  active: boolean;
  isProfile: boolean;
  avatarUrl: string | null | undefined;
  initials: string;
  onPress: () => void;
};

/**
 * One destination.
 *
 * The label only exists while this item is selected — unselected destinations
 * are a single larger glyph, which is what keeps five of them legible on a
 * narrow phone.
 *
 * Every glyph is the same size and sits centred in its item. Selecting one
 * lifts it just far enough to open the space its label needs, and the label
 * fades in underneath — so the movement is what marks the selection rather than
 * a size change, and nothing is held back from the four items that are not
 * selected.
 */
function NavItem({ label, icon: Icon, active, isProfile, avatarUrl, initials, onPress }: ItemProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, FADE);
  }, [active, progress]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, -ICON_LIFT]) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [4, 0]) }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.item}
    >
      <Animated.View style={iconStyle}>
        {isProfile ? (
          <Avatar uri={avatarUrl} initials={initials} size={ICON_SIZE} style={active ? styles.avatarActive : styles.avatar} />
        ) : (
          <Icon color={active ? colors.primary : colors.inkMuted} size={ICON_SIZE} strokeWidth={active ? 2.3 : 1.9} />
        )}
      </Animated.View>
      {/* Absolutely placed, so its arrival never resizes the row. */}
      <Animated.Text numberOfLines={1} style={[styles.label, labelStyle]}>{label}</Animated.Text>
    </Pressable>
  );
}

/**
 * The floating bar, rendered once by the tab navigator rather than by each
 * screen. That is what keeps it still while only the page behind it changes.
 */
export function BottomNav({ state, navigation }: TabBarProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { profile } = useAccount();
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  const items = state.routes.filter((route) => LABELS[route.name]);
  const activeKey = state.routes[state.index]?.key;
  const activeIndex = Math.max(items.findIndex((route) => route.key === activeKey), 0);
  const itemWidth = items.length > 0 ? barWidth / items.length : 0;

  const indicator = useSharedValue(0);
  useEffect(() => {
    indicator.value = withSpring(activeIndex * itemWidth + INDICATOR_INSET, SPRING);
  }, [activeIndex, indicator, itemWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: Math.max(itemWidth - INDICATOR_INSET * 2, 0),
    transform: [{ translateX: indicator.value }],
    opacity: itemWidth > 0 ? 1 : 0,
  }));

  return (
    <View
      pointerEvents="box-none"
      // Sits close to the edge, stepping back only by what keeps it clear of the
      // home indicator's gesture area.
      style={[styles.wrap, { bottom: Math.max(insets.bottom - 20, 10) }]}
    >
      {/* The shadow lives on an outer view so it is not clipped by the capsule's
          own overflow:hidden, which is what makes a floating bar look pasted on. */}
      <View style={styles.shadow}>
        <View style={styles.bar}>
          {BLUR_LINKED ? (
            <BlurView
              intensity={Platform.OS === "ios" ? 60 : 30}
              tint={scheme}
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <LinearGradient
            colors={sheenOf(colors)}
            locations={[0, 0.5, 1]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.row} onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}>
            <Animated.View pointerEvents="none" style={[styles.indicator, indicatorStyle]} />
            {items.map((route) => {
              const meta = LABELS[route.name];
              if (!meta) return null;
              const active = route.key === activeKey;
              return (
                <NavItem
                  key={route.key}
                  label={meta.label}
                  icon={meta.icon}
                  active={active}
                  isProfile={route.name === "profile"}
                  avatarUrl={profile?.avatar_url}
                  initials={profileInitials(profile)}
                  onPress={() => {
                    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                    if (!active && !event.defaultPrevented) navigation.navigate(route.name);
                  }}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Absolute, so the navigator's tab-bar slot collapses to nothing and the bar
  // floats over the page instead of pushing it up. Equal inset on both sides.
  wrap: { position: "absolute", left: BAR_INSET, right: BAR_INSET },
  shadow: {
    borderRadius: BAR_RADIUS,
    backgroundColor: "transparent",
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  bar: {
    borderRadius: BAR_RADIUS,
    overflow: "hidden",
    // A single hairline rim. Anything heavier stops reading as an edge of glass
    // and starts reading as a drawn outline.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassRim,
  },

  // No padding on the row. Yoga positions an absolutely placed child against
  // the border box rather than the content box, so a padded parent would leave
  // the indicator sitting that padding higher than the items it is meant to sit
  // behind. The vertical room comes from the row's height instead.
  row: { flexDirection: "row", height: BAR_HEIGHT, alignItems: "center" },
  indicator: {
    position: "absolute",
    left: 0,
    top: BAR_PAD_V,
    height: ITEM_HEIGHT,
    borderRadius: ITEM_HEIGHT / 2,
    backgroundColor: colors.primarySoft,
  },
  item: { flex: 1, height: ITEM_HEIGHT, alignItems: "center", justifyContent: "center" },
  label: {
    position: "absolute",
    bottom: 7,
    fontFamily: "Manrope_600SemiBold",
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0.1,
    color: colors.primary,
  },
  avatar: { borderWidth: 1.5, borderColor: colors.border, borderRadius: ICON_SIZE / 2 },
  avatarActive: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: ICON_SIZE / 2 },
}));
