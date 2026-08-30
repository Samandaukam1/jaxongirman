import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The three ways a "delete my account" quietly stops being one.
 *
 * None of them fail loudly. A bucket added next year keeps a folder of somebody
 * else's photographs after they asked for them to be gone. A ledger table that
 * drifts into the generic sweep takes a sale's other half with it. A `restrict`
 * key added to a new table turns the whole deletion into a 500 for the one
 * person unlucky enough to have a row in it.
 *
 * So the invariants are read out of the migrations rather than trusted: what
 * the schema says about ownership has to agree with what `purge_account_data`
 * does about it, on every run, forever.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const migrations = () =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");

const purgeSource = readFileSync(path.join(migrationsDir, "202608300001_delete_account.sql"), "utf8");

/** A `const name text[] := array[ … ];` block from the function's declarations. */
function declaredList(name) {
  const at = purgeSource.indexOf(`${name} constant text[] := array[`);
  assert.ok(at > 0, `${name} ro‘yxati topilmadi`);
  const body = purgeSource.slice(at, purgeSource.indexOf("];", at));
  return [...body.matchAll(/'([a-z0-9_-]+)'/g)].map((match) => match[1]);
}

test("every bucket a person can write to is swept when their account goes", () => {
  /**
   * "Can write to" is not a list anybody keeps — it is what the storage
   * policies say. A bucket whose insert policy pins the first path segment to
   * `auth.uid()` is by definition a bucket holding folders named after people.
   */
  const owned = new Set();
  for (const [, bucket] of migrations().matchAll(
    /with check \(\s*bucket_id = '([a-z0-9-]+)'\s+and \(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g,
  )) {
    owned.add(bucket);
  }
  assert.ok(owned.size >= 5, `foydalanuvchi yozadigan buketlar o‘qilmadi (${owned.size})`);

  const swept = new Set(declaredList("buckets"));
  const missed = [...owned].filter((bucket) => !swept.has(bucket)).sort();
  assert.deepEqual(missed, [], `purge_account_data quyidagi buketlarni tozalamaydi: ${missed.join(", ")}`);
});

test("no ledger is emptied by the generic sweep", () => {
  const retained = declaredList("retained");
  for (const ledger of ["orders", "payment_transactions", "marketplace_purchases", "seller_ledger_entries", "seller_settlements", "credit_transactions"]) {
    assert.ok(retained.includes(ledger), `${ledger} moliyaviy yozuv — u saqlanishi kerak`);
  }

  /**
   * The sweep finds its tables by asking the catalogue for cascade keys, so the
   * only thing standing between a ledger and a `delete` is its name being on
   * that list. Nothing else in the function may delete from one either.
   */
  const body = purgeSource.slice(purgeSource.indexOf("create or replace function public.purge_account_data"));
  for (const ledger of retained) {
    assert.ok(
      !new RegExp(String.raw`delete\s+from\s+public\.${ledger}\b`, "i").test(body),
      `purge_account_data ${ledger} jadvalidan o‘chiryapti`,
    );
  }
});

test("every table that refuses to let a user go is a reason the user is told about", () => {
  /**
   * `on delete restrict` on a key to `auth.users` is Postgres saying "this
   * account cannot simply be deleted". Each one has to be a named reason, or
   * the deletion meets it as a 500 rather than as the anonymised outcome it was
   * designed to have.
   */
  const source = migrations();
  const blockers = new Set();
  for (const match of source.matchAll(/create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, columns] = match;
    for (const [, column] of columns.matchAll(/(\w+)\s+uuid[^,]*references auth\.users\(id\) on delete restrict/g)) {
      blockers.add(`${table}.${column}`);
    }
  }
  assert.ok(blockers.size >= 4, `restrict kalitlari o‘qilmadi (${blockers.size})`);

  const reasons = purgeSource.slice(
    purgeSource.indexOf("create or replace function public.account_retention_reasons"),
    purgeSource.indexOf("create or replace function public.purge_account_data"),
  );
  const unhandled = [...blockers]
    .filter((key) => {
      const [table, column] = key.split(".");
      return !new RegExp(String.raw`from public\.${table}\s+where[\s\S]{0,120}?\b${column} = p_user`).test(reasons);
    })
    .sort();
  assert.deepEqual(unhandled, [], `bu kalitlar hisobni o‘chirishni to‘xtatadi va sabab sifatida ko‘rsatilmagan: ${unhandled.join(", ")}`);
});

test("the purge is service-role only, and the function reads its user from the token", () => {
  for (const routine of ["account_retention_reasons", "purge_account_data"]) {
    assert.match(
      purgeSource,
      new RegExp(String.raw`revoke all on function public\.${routine}\(uuid\) from authenticated;`),
      `${routine} authenticated roldan olib tashlanmagan`,
    );
    assert.match(
      purgeSource,
      new RegExp(String.raw`grant execute on function public\.${routine}\(uuid\) to service_role;`),
      `${routine} service_role uchun berilmagan`,
    );
  }

  const edge = readFileSync(path.join(repoRoot, "supabase", "functions", "delete-account", "index.ts"), "utf8");
  // The id comes from `getUser()` on the caller's own token. A body-supplied id
  // would be one typo away from deleting somebody else.
  assert.match(edge, /const userId = caller\.user\.id;/, "o‘chiriladigan foydalanuvchi tokendan olinmayapti");
  assert.ok(!/body\.userId|body\.user_id/.test(edge), "funksiya foydalanuvchi id sini so‘rovdan olmasligi kerak");
  assert.match(edge, /body\?\.confirm !== CONFIRMATION/, "tasdiqlash so‘zi tekshirilmayapti");
  assert.match(edge, /purge_account_data/, "funksiya tozalash RPC sini chaqirmayapti");
});

test("the function is declared, or the gateway answers before it ever runs", () => {
  /**
   * Every function in this project turns gateway JWT parsing off and checks the
   * token itself, because a project on asymmetric keys has the gateway refusing
   * tokens the function would have accepted. A function that is simply missing
   * from `config.toml` inherits the default and fails that way — as a 401 with
   * no log line, from code that is correct.
   */
  const config = readFileSync(path.join(repoRoot, "supabase", "config.toml"), "utf8");
  assert.match(
    config,
    /\[functions\.delete-account\]\s*\nverify_jwt = false/,
    "delete-account config.toml da e'lon qilinmagan",
  );
});
