# AI generation pipeline

Generation is a staged, observable job rather than one large prompt.

```mermaid
flowchart TD
  I[Validated topic + sources + uploads] --> X[Document context preparation]
  X --> O[Structured outline]
  O --> C[Structured slide content]
  C --> V[Visual DNA]
  V --> P[Asset and layout planning]
  P --> G[Optional image provider]
  G --> R[Deterministic editable element rendering]
  R --> Q[Quality checks]
  Q -->|repair needed| F[Layout repair]
  F --> Q
  Q --> S[Save + settle credits]
```

`generate-presentation` authenticates the user, validates owned assets, calls the atomic reservation RPC, and runs the pipeline in the background. Each stage updates `generation_steps` and job progress for Realtime/polling clients. A failure keeps the presentation record, marks the job with a safe error, and releases reserved credits. Retry creates a new idempotent job.

## Structured model calls

Outline, content and editor commands use strict JSON schemas through the Responses API. Provider calls record model, token counts, generated image count, latency and estimated cost in `ai_usage`. Pricing snapshots live in `app_settings` and can be changed through the audited admin console.

The text and image clients are adapters. The default text model is configurable with `OPENAI_TEXT_MODEL`; image generation uses the requested `gpt-image-1.5` through an `ImageProvider` abstraction, so a later provider can be added without changing layout or billing code.

## Visual DNA and quality

One Visual DNA object establishes mood, era, palette, typography, texture, illustration direction, icon language, spacing and chart language for the whole deck. The deterministic layout engine turns structured slide plans into independent, editable text/image/shape/chart/table elements on a 1000 × 562.5 canvas.

The quality pass checks bounds, overlap risk, readable text sizes, contrast assumptions, density and missing required content. Repair adjusts layout before a deck can become `ready`.

## Uploaded source privacy

User uploads stay in private Storage. For supported text documents, the worker creates a short-lived provider file only when necessary and deletes it in `finally`. Generated assets return to private Storage. Provider keys and service-role access exist only in the Edge runtime.

## Mock and production modes

Mock generation is enabled only when the server environment explicitly sets `GENERATION_MODE=mock`. It exercises the real database, credits, progress, editor and export paths without provider calls. `GENERATION_MODE=real` fails safely when `OPENAI_API_KEY` is absent; it never silently substitutes fake content in production.
