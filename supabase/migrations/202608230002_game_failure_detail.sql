/**
 * A failed game has to say why it failed.
 *
 * `games.failure_reason` holds one sentence, written for the person who pressed
 * the button: "O'yin yaratilmadi. Qayta urinib ko'ring." Every failure since
 * the sixteenth of August carries exactly that sentence and nothing else, so
 * five failures in a row are indistinguishable from each other and from any
 * sixth cause nobody has thought of yet. The real error went to `console.error`
 * and into edge logs, which are not reachable from here.
 *
 * So the cause is recorded beside the sentence. `failure_code` is a short slug
 * to count and group by; `failure_detail` is what actually went wrong, kept
 * short and free of anything a provider might put in a message that is not ours
 * to store. Neither is shown to the person — the app reads `failure_reason` —
 * and both survive the worker that wrote them.
 */

alter table public.games
  add column if not exists failure_code text,
  add column if not exists failure_detail text;

comment on column public.games.failure_code is
  'Short slug for why generation failed: provider_unavailable, no_usable_questions, save_failed, unknown. Developer-facing.';
comment on column public.games.failure_detail is
  'What actually went wrong, for diagnosis. Never shown to the person who made the game.';
