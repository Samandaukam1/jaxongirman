# J Tanga economy (v2)

Migrations `202610160001_economy_enums.sql` and `202610160002_economy_v2.sql`;
tests `supabase/tests/database/economy_v2.test.sql` (70 assertions).

## Balances

A person holds three things, never added together:

| Balance | Spent on | Comes from | Where |
|---|---|---|---|
| J Tanga | any service, at the person's rate | packs, tariffs, gifts, sales | `credit_wallets.balance` |
| Welcome pages | presentations only | once per identity at sign-up (30) | `presentation_credit_grants` (`source = 'welcome'`) |
| Bought pages | presentations only | the `pages_10` product, admin gifts | `presentation_credit_grants` (`purchase`, `admin`) |

A coin tariff's J Tanga are part of `balance`. `coin_lots` labels how much of
it is this month's tariff. The trigger `coin_lot_track` keeps that label honest:
spending takes from the lot first, and a refund puts back what its reservation took.
`expire_coin_lots` burns what is left when the month runs out unrenewed. It runs
lazily on wallet access and globally from `generate-presentation`. Buying a
tariff while a month is running rolls the remainder into the new lot.

## Prices

`economy_versions` + `service_prices`, versioned and never edited in place.
The active version is the newest one whose `effective_from` has passed. Every job stores its
quote (`generation_jobs.pricing`), so a later price change never reaches it.

A presentation costs `pages × coins_per_unit (10) × multiplier`, rounded by
the version's rule (`ceil`). The multiplier comes from the person's tariff
snapshot (`user_subscriptions.plan_snapshot.page_multiplier`), or from
`no_plan_multiplier` (OSON's rate) when they have no tariff.

| Tariff | Price | Multiplier | 10-page deck | Monthly J Tanga |
|---|---|---|---|---|
| OSON | 19 000 | 41 800 / 34 000 | 123 | 10 × 123 = 1 230 |
| MAZZA | 26 000 | 5 720 000 / 5 100 000 | 113 | 15 × 113 = 1 695 |
| BEMALOL | 34 000 | 1 | 100 | 22 × 100 = 2 200 |

Pages are taken in this order: welcome pages, then bought pages, then J Tanga.
A deck that takes welcome pages is at most 10 pages long (the welcome is three
ten-page decks); `start_generation` refuses a longer one with `free_deck_max_pages`.
`presentation_quote(p_slide_count)` returns that breakdown. `start_generation`
reserves it in the same transaction as the job. Its `p_confirmed_coins` makes
the person confirm again if the price has risen since they saw it.
`settle_generation` charges a priced job exactly its quote. `fail_generation`
gives back the J Tanga, the pages and a PREMIUM member's weekly allowance.

## Legacy PREMIUM

`premium_monthly` (`billing_model = 'quota'`) is no longer sold. Members keep their
weekly allowance until their subscription ends. If they buy a coin tariff, their unused
decks for the current week convert into J Tanga at the new tariff's deck price.

## Fulfilment

`order_fulfil` writes `user_subscriptions` again. Migration `202609010900`
had rebuilt it from a version that predated `202608230010` and dropped that
branch, but no paid subscription order existed in the meantime. A coin
tariff's month is granted through `plan_lot_grant`. `pages_10` grants exactly
ten bought pages, keyed by the order, so a repeated callback grants nothing.

## Shop

Buying from the shop needs no tariff (`202610190001`): `assert_marketplace_member('buy')`
only asks that somebody is signed in, and what a purchase unlocks — download,
presenting, hosting a bought game — was never tied to a plan. Selling still needs
a plan with `marketplace_access` and `marketplace_sell`. Tariff cards no longer
list buying; the console's tariff builder has no "Xarid qilish" switch.

## Admin

`/iqtisod` (J Tanga iqtisodiyoti) runs on `admin_economy_overview`. Price
changes publish a new version (`admin_publish_economy`, super admin only).
Tariff economy settings are saved with `admin_save_plan_economy`, packs with
`admin_save_package`, page gifts with `admin_grant_presentation_pages`. The
welcome is extended to old accounts only on purpose, with
`admin_welcome_backfill`. Every change is written to `admin_audit_logs`.
`economy_warnings` reports a tariff whose J Tanga do not cover its promised decks,
an estimated cost above the price, and packs priced far below the reference value.
