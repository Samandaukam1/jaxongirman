-- The generator could not read the design it was told to render with.
--
-- `presentation_designs` was granted to `anon` and `authenticated` — the two
-- roles that browse the catalogue — and to nobody else. But the pipeline runs
-- under the service role, and this repo revoked the default privileges that
-- would otherwise have covered it (202608100012), so the lookup failed with
-- `permission denied` and every JSLAYD deck quietly fell back to its built-in
-- blueprint. The fallback worked exactly as designed, which is why nothing
-- broke and why only an end-to-end run could find it.
--
-- `presentations` already carries the grant, which is the shape to match: the
-- three design tables are read by the same server-side code, for the same
-- reason, and are read-only to it.
grant select on
  public.presentation_designs,
  public.presentation_design_fonts,
  public.presentation_design_versions
to service_role;
