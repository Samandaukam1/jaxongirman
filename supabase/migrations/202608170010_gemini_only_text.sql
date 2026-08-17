-- Presentation text has one provider.
--
-- Gemini wrote first and OpenAI stood behind it, on the reasoning that a
-- generator which stops when one vendor has a bad afternoon is not a generator
-- anybody can sell. That reasoning was wrong in a specific way: the second
-- vendor was not a spare, it was a second bill, and when its balance reached
-- zero it did not wait quietly — it took over the moment Gemini returned
-- anything at all and then failed the deck itself, on a paying customer's
-- screen, at twenty-eight per cent.
--
-- So research, outlines, slide copy, rewrites and the slide editor are all
-- written by Gemini, and the resilience lives inside that one provider: a
-- request is retried while retrying can help, and research that cannot reach
-- the live web is answered from the model's own knowledge and labelled as such.
--
-- Nothing is dropped or renamed here. `ai_usage.provider` still holds whatever
-- ran a call — the game generator is a different product and still uses OpenAI,
-- and years of historical rows say `openai` because that is what happened. Only
-- the description changes, because the old one describes a fallback that no
-- longer exists and a reader trusting it would look for rows that will never
-- appear again.

comment on table public.ai_usage is
  'One row per model call. `provider` and `model` name what actually ran it. Presentation text (topic_research, presentation_outline, presentation_content, content_rewrite, editor_command) is always provider = google; `metadata.attempts` counts the requests a stage took, and on research `metadata.grounded_search` says whether the live web was reached — false means the model answered from its own knowledge and the deck has no citations.';
