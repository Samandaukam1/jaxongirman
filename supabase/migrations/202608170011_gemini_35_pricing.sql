-- Gemini 3.5's prices, before anything runs on it.
--
-- The generator prices each stage by the model that actually ran it, so a model
-- nobody listed logs a zero. A zero is honest — it reads as a gap rather than a
-- wrong number — but it is still a deck whose cost nobody knows, and moving the
-- whole product onto an unlisted model would mean a month of those.
--
-- Published paid-tier rates for gemini-3.5-flash-lite at the time of writing.
-- Worth reading twice before assuming this is a cheap change: against
-- gemini-2.5-flash-lite ($0.10 / $0.40) it is three times the input and just
-- over six times the output. A deck is output-heavy, so the per-deck provider
-- cost rises accordingly, and the credit pricing was set against the old rate.
--
-- The 3.5 line is also billed for grounded search separately — 5,000 requests a
-- month across all 3.x models, then $14 per 1,000. Research makes one grounded
-- request per deck, so that allowance is roughly five thousand decks a month
-- before search itself starts costing anything. Nothing here tracks it: this
-- table prices tokens, and a per-request charge is not a token. It is written
-- down so the first surprising invoice is not the first anybody hears of it.
update public.app_settings
   set value = value || jsonb_build_object(
     'gemini-3.5-flash-lite', jsonb_build_object(
       'input_per_million', 0.30,
       'output_per_million', 2.50
     )
   )
 where key = 'ai.provider_pricing';
