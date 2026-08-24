/**
 * SVG files import as components, not as asset URIs.
 *
 * `react-native-svg-transformer` compiles them at bundle time (see
 * `metro.config.js`), so `import Art from "…/thing.svg"` yields a real
 * `react-native-svg` component.
 */
declare module "*.svg" {
  import type { FC } from "react";
  import type { SvgProps } from "react-native-svg";

  const content: FC<SvgProps>;
  export default content;
}
