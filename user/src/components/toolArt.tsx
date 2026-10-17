import { memo, type ComponentType } from "react";
import { Image, type ImageRequireSource } from "react-native";

import portrait from "../../assets/icons/1.png";
import objective from "../../assets/icons/2.png";
import scientific from "../../assets/icons/3.png";
import slideCreate from "../../assets/icons/4.png";
import powerPoint from "../../assets/icons/5.png";
import present from "../../assets/icons/6.png";

/**
 * The tool drawings Loyihalar and the project rows use.
 *
 * Each SVG in `assets/icons` is a 1536 px photograph wrapped in masks, and
 * compiled to a component it put ~950 KB of base64 into the JavaScript bundle —
 * six of them were half the app's code, parsed on every launch to draw pictures
 * no larger than 74 pt. These are the same drawings rendered once to 240 px
 * PNGs (74 pt at 3x, with room), which load as ordinary image assets. Same
 * call shape as the SVG components (`<Art width height />`), so a card does
 * not know which it was handed.
 */

export type ArtProps = { width: number; height: number };
export type Art = ComponentType<ArtProps>;

function drawing(source: ImageRequireSource, name: string): Art {
  const Drawing = memo(function Drawing({ width, height }: ArtProps) {
    return <Image source={source} style={{ width, height }} resizeMode="contain" accessible={false} />;
  });
  Drawing.displayName = name;
  return Drawing;
}

export const PortraitArt = drawing(portrait, "PortraitArt");
export const ObjectiveArt = drawing(objective, "ObjectiveArt");
export const ScientificArt = drawing(scientific, "ScientificArt");
export const SlideCreateArt = drawing(slideCreate, "SlideCreateArt");
export const PowerPointArt = drawing(powerPoint, "PowerPointArt");
export const PresentArt = drawing(present, "PresentArt");
