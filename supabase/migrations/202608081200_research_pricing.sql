-- Rebalances generation pricing around what each part of a deck actually costs,
-- now that every generation researches the live web before writing.
--
-- Measured against ai.provider_pricing, with 1 credit ≈ $0.04 (credits.packages):
--   web research   ~$0.13  ≈ 3.3 credits   → folded into base_credits
--   outline+content ~$0.13 ≈ 3.3 credits   → base_credits + credits_per_slide
--   one image       $0.05  ≈ 1.25 credits  → credits_per_image
--
-- Text was priced far above its cost and imagery below it, so per-slide rates
-- come down and per-image rates go up. A ten-slide deck lands within a credit or
-- two of its old total; the money simply follows the expensive part.

insert into public.style_configs (
  style, label, description, base_credits, credits_per_slide,
  expected_image_ratio, credits_per_image, config
)
values
  ('simple', 'Oddiy', 'Researched text, professional vectors, shapes and typography without generated images', 6, 0.70, 0, 0,
    '{"complexity":"fast","visuals":"vector","image_provider":null}'::jsonb),
  ('good', 'Yaxshi', 'Researched text with icons, charts, licensed web imagery and uploaded assets', 6, 0.80, 0.30, 3,
    '{"complexity":"medium","visuals":"mixed","image_provider":"search"}'::jsonb),
  ('great', 'Ajoyib', 'Researched text with editorial illustration, infographics and richer storytelling', 7, 1.00, 0.60, 4,
    '{"complexity":"long","visuals":"illustrated","image_provider":"openai"}'::jsonb),
  ('super_professional', 'Super professional', 'Researched text with premium AI-generated visual storytelling and art direction', 9, 1.20, 0.80, 6,
    '{"complexity":"long","visuals":"premium_generated","image_provider":"openai"}'::jsonb)
on conflict (style) do update set
  label = excluded.label,
  description = excluded.description,
  base_credits = excluded.base_credits,
  credits_per_slide = excluded.credits_per_slide,
  expected_image_ratio = excluded.expected_image_ratio,
  credits_per_image = excluded.credits_per_image,
  config = excluded.config,
  is_active = true;

-- The bibliography and closing slides mean a deck is only worth generating from
-- five slides up; below that the fixed pages would leave no room for content.
insert into public.app_settings (key, value, description, public_read)
values ('generation.min_slide_count', '5'::jsonb, 'Minimum slides per generation job; the deck reserves four for cover, agenda, references and closing', true)
on conflict (key) do update set value = excluded.value, description = excluded.description, public_read = excluded.public_read;
