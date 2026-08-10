# Jaxongirman

Jaxongirman is a connected production system built on one account, one wallet and one set of roles. It carries two products today — **Jaxongir Slides**, an AI presentation generator, and **Ma'lumotlarni yig'ish**, a survey and data-collection module — behind a shared home screen. The repository contains the Expo iOS/Android user app, the web admin console, shared database types, and the complete Supabase backend.

## Repository map

```text
user/                 Expo Router mobile app
admin/                Vite + React admin console
packages/types/       Shared domain and generated database types
supabase/migrations/  Reproducible schema, functions, RLS and storage policies
supabase/functions/   Secure AI generation, editing and export workers
supabase/tests/       pgTAP database/RLS/credit tests
docs/                 Architecture and operational documentation
```

## Local setup

Requirements: Node.js 20+, npm, Docker Desktop, and PostgreSQL `psql` only if you want to run the admin promotion helper.

```bash
npm install
npm run supabase:start
```

Copy the client-safe examples to `user/.env` and `admin/.env`, then fill them with the local API URL and anon key printed by `npx supabase status`. Never put a service-role or OpenAI key in either client file.

```bash
cp user/.env.example user/.env
cp admin/.env.example admin/.env
```

For AI functions, copy `supabase/functions/.env.example` to the ignored `supabase/functions/.env`. Real mode requires `OPENAI_API_KEY`. For local UI development without a provider key, use `GENERATION_MODE=mock`; production must remain `real`.

Run each surface in a separate terminal:

```bash
npx supabase functions serve --env-file supabase/functions/.env
npm run dev:mobile
npm run dev:admin
```

The mobile app uses Expo Router and is ready for iOS, Android and tablet layouts. The admin app defaults to Vite's local URL.

## Admin access

Create an account through the app first. Promote that account locally without using the Dashboard:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  --set=email=admin@example.com \
  --file=supabase/scripts/grant-admin.sql
```

The web console still calls `is_admin()` on the server before rendering. User status, credit, pricing and settings mutations run through audited security-definer RPCs; the browser never receives privileged credentials.

For a hosted project, run the same data script through a secure server/database connection. Do not expose a database password or service-role key to either client.

## Database workflow

All schema changes belong in a new `supabase/migrations/*.sql` file.

```bash
npx supabase db reset --local
npx supabase db lint --local --level warning
npm run test:db
npm run supabase:types
```

`db reset --local` is intentionally local-only. On a linked remote project, review migrations and use `npx supabase db push`; never reset the remote database. This implementation does not reset or mutate a linked remote project.

## Verification

```bash
npm run typecheck
npm run lint
npm run build:admin
```

With local functions running in explicit mock mode, `npm run test:functions:local` creates a disposable authenticated account and verifies generation, AI editing, private PDF export, and credit settlement end to end. The account and its cascaded records are deleted afterward.

## Production deployment outline

1. Link the intended Supabase project and review pending migrations.
2. Push forward-only migrations.
3. Set `OPENAI_API_KEY` and model configuration with Supabase secrets.
4. Deploy `generate-presentation`, `edit-presentation` and `export-presentation`.
5. Configure the client-safe hosted URL and anon/publishable key in Expo and Vite build environments.
6. Build the mobile apps with EAS and deploy the admin bundle to the chosen web host.

See [architecture](docs/architecture.md), [database](docs/database.md), [AI pipeline](docs/ai-pipeline.md), and [data collection](docs/data-collection.md) for the implementation contracts.

## Products

The user app opens on a dashboard with five destinations: **Bosh sahifa**,
**Loyihalar** (the presentation generator), **Marketplace**, **O'yinlar** and
**Profil**. The home screen answers three things at a glance — the J Coin
balance, the way into Ma'lumotlarni yig'ish, and whether anything is waiting in
the inbox.

**J Coin** is the existing credit wallet, not a second currency.
Person-to-person transfers go through `transfer_credits()`, which locks both
wallets in id order, refuses to overdraw and is idempotent per sender key; a
client never writes a balance. Purchases are listed from the admin-owned
`coin_packages` catalogue, and while `app_settings.payments.config` reports
`configured: false` the app says so rather than simulating a payment.

**Ma'lumotlarni yig'ish** is documented in full in
[docs/data-collection.md](docs/data-collection.md): its privacy model (an
abandoned form stores nothing; submitted answers expire on a stated window), the
retention sweep and how to schedule it, and the access switches that stay off
until a payment provider exists.

### Not yet connected

- **Payment provider.** None is integrated. Coin packages and the module price
  are real, admin-configured values; nothing in either app completes a purchase,
  and the UI states that plainly. Wiring one up means adding a provider callback
  that writes `module_entitlements` (source `purchase`) or credits the wallet,
  then turning on `payments.config.configured` in the admin console.
- **Marketplace catalogue.** No listing table exists yet, so the Marketplace tab
  and the home section render an empty state rather than sample products.
- **Games.** A route shell only.

## Troubleshooting

- If a client cannot connect, confirm Docker is healthy and the URL uses the host reachable by the simulator/device; a physical phone cannot use its own `127.0.0.1` to reach your laptop.
- If generation fails immediately, inspect the job steps and function logs. Mock mode must be set explicitly and only for local development.
- If admin login is denied, verify the account has an `admin` row in `user_roles` and sign in again.
- If generated types drift, start local Supabase, replay migrations, then run `npm run supabase:types`.
