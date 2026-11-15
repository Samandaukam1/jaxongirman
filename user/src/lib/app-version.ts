import Constants from "expo-constants";

/**
 * The version of the app on this phone, as `app.json` gave it to the build
 * (or to the update the phone is running): "2.0.0".
 */
export function installedVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}
