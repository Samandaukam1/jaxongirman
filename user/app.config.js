/**
 * The parts of the app config that depend on the environment.
 *
 * `app.json` stays the static base and is passed in here as `config` — Expo
 * reads it first, so nothing that already works is retyped in this file or put
 * at risk by it. Only what cannot be known until build time lives here.
 *
 * Why it has to be build time: `@react-native-google-signin/google-signin`
 * needs the reversed iOS client ID registered as a URL scheme in the native
 * project. A URL scheme is baked into the binary; no environment variable read
 * at runtime can add one. So the rule is: set the variables, then build once.
 * Changing them later needs another build, not another edit.
 *
 * One caveat, the same one the entitlements file carries: `ios/` is checked in,
 * so EAS Build does not sync the `ios` block or the plugin list into it. What
 * is written here governs Android, which has no native folder and is generated
 * from this config; iOS additionally needs the same two facts written into
 * `ios/Jaxongirman/Jaxongirman.entitlements` and `Info.plist`. The entitlement
 * is already there. The URL scheme cannot be — it is derived from a client ID
 * that does not exist yet — so docs/social-auth-setup.md carries it as a step.
 */

/* global __dirname -- Expo evaluates this file in Node, as CommonJS. */
const fs = require("fs");
const path = require("path");

/** `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`. */
function reversedClientId(clientId) {
  const suffix = ".apps.googleusercontent.com";
  if (!clientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

module.exports = ({ config }) => {
  const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "").trim();
  const iosUrlScheme = iosClientId ? reversedClientId(iosClientId) : null;

  const plugins = [
    ...(config.plugins ?? []),
    "expo-apple-authentication",
    // Push notifications. Android's small icon must be a white silhouette, or the system draws a white square.
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#6C34C9", defaultChannel: "default" }],
  ];

  // Android delivers pushes through Firebase, so a build needs the project's
  // google-services.json. It is not committed (the repository is public): on
  // EAS it is a file environment variable, GOOGLE_SERVICES_JSON; locally a
  // file beside this one. A build without it installs and works, and simply
  // never registers for push — see src/lib/push.ts.
  const googleServices = (process.env.GOOGLE_SERVICES_JSON ?? "").trim()
    || (fs.existsSync(path.join(__dirname, "google-services.json")) ? "./google-services.json" : "");
  if (!googleServices && process.env.EAS_BUILD_PLATFORM === "android") {
    console.warn("[app.config] GOOGLE_SERVICES_JSON is not set — this Android build will not receive push notifications.");
  }

  // Added only when there is a real client ID to derive the scheme from. A
  // build with a placeholder scheme would install and then fail at the moment
  // somebody presses the button, which is the worst place to find out; a build
  // without the plugin says "not configured" on the screen instead.
  if (iosUrlScheme) {
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme }]);
  } else if (process.env.EAS_BUILD) {
    console.warn(
      "[app.config] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not set — Google sign-in will report itself unconfigured in this build.",
    );
  }

  // The website serves the browser build under a path of its own (`/app`, see
  // web/next.config.ts). Set only for that export; phone builds never see it.
  const webBase = (process.env.EXPO_WEB_BASE_URL ?? "").trim();

  return {
    ...config,
    ...(webBase ? { experiments: { ...config.experiments, baseUrl: webBase } } : {}),
    android: {
      ...config.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
    ios: {
      ...config.ios,
      // Apple requires this entitlement for the button to work at all, and
      // requires the button itself on any app offering another social login.
      usesAppleSignIn: true,
    },
    plugins,
  };
};
