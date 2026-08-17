import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { OpenAIClient } from "../openai.ts";
import type { GeneratedImage, VisualDna } from "../presentation-types.ts";

type GenerateInput = {
  ownerId: string;
  presentationId: string;
  slideIndex: number;
  topic: string;
  direction: string;
  visualDna: VisualDna;
};

export interface ImageProvider {
  generate(input: GenerateInput): Promise<GeneratedImage>;
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly openai: OpenAIClient, private readonly service: SupabaseClient, private readonly costPerImage: number) {}

  async generate(input: GenerateInput): Promise<GeneratedImage> {
    // The design dictates the look; the model only contributes subject matter.
    // Both halves now come from `visualDna`, which is composed from the JSLAYD
    // document the deck will actually be laid into — so the imagery cannot be
    // directed by one design while the slides are built by another.
    const dna = input.visualDna;
    const prompt = [
      "Professional presentation visual asset.",
      `Topic: ${input.topic}.`,
      `Art direction: ${dna.illustrationStyle}; mood ${dna.mood}.`,
      `Strictly use this colour palette: ${Object.values(dna.palette).join(", ")}.`,
      input.direction,
      "Single coherent visual asset, generous negative space, clean composition, presentation-safe crop.",
      "No typography, no letters, no numerals, no logo, no watermark, no slide screenshot, no UI frame.",
    ].join(" ");
    const result = await this.openai.generateImage(prompt);
    const path = `${input.ownerId}/${input.presentationId}/${crypto.randomUUID()}.png`;
    const { error } = await this.service.storage.from("generated-images").upload(path, result.bytes, { contentType: "image/png", upsert: false });
    if (error) throw error;
    return { slideIndex: input.slideIndex, bucket: "generated-images", path, provider: this.openai.imageModel, costUsd: this.costPerImage };
  }
}
