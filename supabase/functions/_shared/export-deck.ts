/**
 * A ready deck as the exporters read it: its presentation, its slides in
 * order, its elements by depth — the owner's rows only.
 *
 * Shared by the deck export and the defence script, which draws the same
 * slides small beside what is said over them.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import type { ExportDeck, ExportElement, ExportPresentation, ExportSlide } from "./export-model.ts";

export async function loadExportDeck(service: SupabaseClient, presentationId: string, ownerId: string): Promise<ExportDeck> {
  const [presentationResult, slidesResult, elementsResult] = await Promise.all([
    service.from("presentations").select("id,title,owner_id").eq("id", presentationId).eq("owner_id", ownerId).eq("status", "ready").single(),
    service.from("slides").select("id,presentation_id,position,title,background").eq("presentation_id", presentationId).eq("owner_id", ownerId).order("position"),
    service.from("slide_elements").select("id,slide_id,presentation_id,type,x,y,width,height,rotation,z_index,opacity,style,content").eq("presentation_id", presentationId).eq("owner_id", ownerId).order("z_index"),
  ]);
  if (presentationResult.error) throw presentationResult.error;
  if (slidesResult.error) throw slidesResult.error;
  if (elementsResult.error) throw elementsResult.error;
  if (!slidesResult.data.length) throw new Error("Presentation has no slides");
  return {
    presentation: presentationResult.data as ExportPresentation,
    slides: slidesResult.data as ExportSlide[],
    elements: elementsResult.data as ExportElement[],
  };
}
