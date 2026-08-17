-- Gemini's prices, in the list that already holds every other model's.
--
-- The generator reads `ai.provider_pricing` by model name, so a stage that runs
-- on a model nobody priced logs a zero. A zero is visible in the dashboard as a
-- gap; a number hardcoded beside the call is not visible at all and is wrong
-- the first time a vendor changes it.
--
-- Published rates for gemini-2.5-flash-lite at the time of writing. They are a
-- setting precisely so correcting them is an admin edit rather than a deploy —
-- nothing in the code knows what a token costs.
update public.app_settings
   set value = value || jsonb_build_object(
     'gemini-2.5-flash-lite', jsonb_build_object(
       'input_per_million', 0.10,
       'output_per_million', 0.40
     ),
     'gemini-2.5-flash', jsonb_build_object(
       'input_per_million', 0.30,
       'output_per_million', 2.50
     )
   )
 where key = 'ai.provider_pricing';

comment on table public.ai_usage is
  'One row per model call. `provider` and `model` name what actually ran it, so a fallback from Gemini to OpenAI is countable rather than anecdotal; `metadata` carries primary_provider / fallback_provider / fallback_reason when one happened.';
