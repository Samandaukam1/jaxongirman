/**
 * Metro resolves an imported image to an opaque asset id. Expo SDK 57 ships no
 * ambient declaration for those, so importing artwork needs this one.
 */

declare module "*.png" {
  import type { ImageRequireSource } from "react-native";

  const asset: ImageRequireSource;
  export default asset;
}

declare module "*.jpg" {
  import type { ImageRequireSource } from "react-native";

  const asset: ImageRequireSource;
  export default asset;
}

declare module "*.jpeg" {
  import type { ImageRequireSource } from "react-native";

  const asset: ImageRequireSource;
  export default asset;
}

declare module "*.webp" {
  import type { ImageRequireSource } from "react-native";

  const asset: ImageRequireSource;
  export default asset;
}
