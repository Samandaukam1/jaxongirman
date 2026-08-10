insert into public.app_settings (key, value, description, public_read)
values
  ('credits.initial_grant', '100'::jsonb, 'Credits granted to a new account', false),
  ('generation.max_slide_count', '30'::jsonb, 'Maximum slides per generation job', true),
  ('generation.mock_mode', 'false'::jsonb, 'Local-only mock generation switch', false),
  ('generation.max_upload_bytes', '52428800'::jsonb, 'Maximum source upload size', true),
  ('generation.allowed_upload_mime_types', '["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain","image/jpeg","image/png","image/webp"]'::jsonb, 'Accepted context uploads', true),
  ('credits.packages', '[{"code":"starter","label":"Starter","credits":100,"price_usd":4.99,"active":true},{"code":"creator","label":"Creator","credits":300,"price_usd":11.99,"active":true},{"code":"studio","label":"Studio","credits":1000,"price_usd":34.99,"active":true}]'::jsonb, 'Purchasable credit package catalog; payment provider integration can map package codes', false),
  ('credits.operation_costs', '{"ai_edit":{"base_credits":1},"pdf_export":{"base_credits":0},"png_export":{"base_credits":0},"image_regeneration":{"base_credits":5}}'::jsonb, 'Non-generation operation prices used by server-side billing adapters', false),
  ('ai.provider_pricing', '{"gpt-5.6-terra":{"input_per_million":2.5,"output_per_million":15},"gpt-5.6-luna":{"input_per_million":1,"output_per_million":6},"gpt-image-1.5":{"medium_landscape_per_image":0.05}}'::jsonb, 'Provider price snapshots used only for cost estimates; update through admin RPC', false)
on conflict (key) do update set value = excluded.value, description = excluded.description, public_read = excluded.public_read;

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
