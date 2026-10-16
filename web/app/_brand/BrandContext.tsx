"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";

/** The site's pictures, for client components that draw the logo themselves. */
const BrandContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): Branding {
  return useContext(BrandContext);
}
