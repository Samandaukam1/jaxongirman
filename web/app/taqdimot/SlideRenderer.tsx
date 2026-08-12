"use client";

import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@jaxongirman/slide-dom";
import { SlideCanvas } from "@jaxongirman/slide-dom";
import type { RenderableSlide, RenderableSlideElement } from "@jaxongirman/types";

/**
 * The projector's slide.
 *
 * The painting itself lives in `@jaxongirman/slide-dom`, shared with the admin
 * console's design preview — an admin whose preview is drawn by different code
 * from the viewer is not previewing anything (§61, §85). This file is the
 * projector's own thin naming of it, kept so the page's imports do not change.
 */
export function WebSlideCanvas({ slide, elements }: { slide: RenderableSlide; elements: RenderableSlideElement[] }) {
  return <SlideCanvas slide={slide} elements={elements} />;
}

export const WEB_SLIDE_SIZE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT } as const;
