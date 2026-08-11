/**
 * O‘yingoh end to end, against the real database: a projector opens a match, a
 * host phone claims it, thirty players join, the whole room answers, the server
 * scores, the podium is ranked, and the reward coins move exactly once.
 *
 * What this exists to prove, beyond "it runs":
 *   * The reward hold is taken *before* the first question and always covers
 *     the worst case, so a match cannot end with an unpayable plan.
 *   * A player cannot read a correct answer — not from the table, not from the
 *     sanitised question, not by asking for somebody else's session.
 *   * A double tap is one answer, and a settled reward paid once is not paid
 *     again by a retried settlement.
 *   * Thirty concurrent joins produce thirty players, not thirty-one.
 *
 * Requires: npx supabase start
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const PLAYER_COUNT = 30;

/**
 * Against the linked remote project when REMOTE=1, so the same assertions can
 * prove the deployed schema behaves like the local one. Credentials come from
 * the environment: nothing here reads a key from a file.
 */
function remoteEnvironment() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error("REMOTE=1 needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, anonKey, serviceKey };
}

function localEnvironment() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const values = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3];
  }
  return {
    url: values.API_URL,
    anonKey: values.ANON_KEY ?? values.PUBLISHABLE_KEY,
    serviceKey: values.SERVICE_ROLE_KEY ?? values.SECRET_KEY,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

const { url, anonKey, serviceKey } = process.env.REMOTE === "1" ? remoteEnvironment() : localEnvironment();
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `${randomUUID()}Aa1!`;

/** A signed-in client for a fresh account. */
async function makeUser(label) {
  const email = `${label}-${randomUUID()}@example.test`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error(`${label} was not created`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id: created.data.user.id, email, client };
}

const created = [];
try {
  /* ------------------------------------------------------------- the game */

  console.log("Building a game the way the editor does…");
  const host = await makeUser("gamehost");
  created.push(host.id);

  const gameInsert = await host.client
    .from("games")
    .insert({ owner_id: host.id, title: "Amir Temur davlati", difficulty: "aralash", audience: "umumiy" })
    .select("id")
    .single();
  if (gameInsert.error) throw gameInsert.error;
  const gameId = gameInsert.data.id;

  const questions = [
    {
      type: "single_choice", prompt: "Amir Temur qaysi yilda tug‘ilgan?",
      explanation: "Amir Temur 1336-yilda Shahrisabz yaqinida tug‘ilgan.",
      config: {
        options: [{ id: "a", text: "1336" }, { id: "b", text: "1370" }, { id: "c", text: "1405" }, { id: "d", text: "1258" }],
        correct: "a",
      },
    },
    {
      type: "true_false", prompt: "Samarqand Amir Temur davlatining poytaxti bo‘lgan.",
      explanation: "Ha — Samarqand poytaxt bo‘lgan.",
      config: { correct: true },
    },
    {
      type: "fill_blank", prompt: "Amir Temur davlatining poytaxti — ...",
      explanation: "Samarqand.",
      config: { answers: ["Samarqand", "samarqand shahri"] },
    },
  ];

  for (const [index, question] of questions.entries()) {
    const inserted = await host.client.from("game_questions").insert({
      game_id: gameId, owner_id: host.id, position: index,
      type: question.type, prompt: question.prompt, explanation: question.explanation,
      time_limit_seconds: 20, base_points: 1000, config: question.config,
    });
    if (inserted.error) throw inserted.error;
  }

  const readied = await host.client.rpc("game_set_status", { p_game_id: gameId, p_status: "ready" });
  if (readied.error) throw readied.error;
  assert(readied.data.question_count === 3, "a game with three gradeable questions becomes ready");

  const badGame = await host.client.from("games").insert({ owner_id: host.id, title: "Bo‘sh o‘yin" }).select("id").single();
  if (badGame.error) throw badGame.error;
  const emptyReady = await host.client.rpc("game_set_status", { p_game_id: badGame.data.id, p_status: "ready" });
  assert(Boolean(emptyReady.error), "a game with no questions refuses to become ready");

  const promote = await host.client.from("games").update({ is_free: true }).eq("id", gameId);
  assert(Boolean(promote.error), "an owner cannot put their own game on everyone's home screen");

  /* -------------------------------------------------------- the projector */

  console.log("Opening a match the way the projector does…");
  const screen = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const opened = await screen.rpc("game_screen_open");
  if (opened.error) throw opened.error;
  assert(/^[A-Za-z0-9_-]{32,64}$/.test(opened.data.token), "an anonymous projector gets an opaque pairing token");
  assert(/^[A-Za-z0-9_-]{32,64}$/.test(opened.data.screen_token), "and a separate screen capability");
  assert(
    new Set([opened.data.token, opened.data.screen_token, opened.data.realtime_token]).size === 3,
    "and none of the three capabilities is reused",
  );

  const anonAdvance = await screen.rpc("game_session_advance", { p_session_id: opened.data.session_id, p_action: "next" });
  assert(Boolean(anonAdvance.error), "a signed-out caller cannot drive a match");

  // The projector renders its own state machine from these two flags. Before a
  // phone claims it, `paired` must be false — reading the join token instead
  // sent the screen straight into an empty lobby and the pairing QR never
  // appeared at all.
  const beforeClaim = await screen.rpc("game_screen_snapshot", {
    p_session_id: opened.data.session_id, p_screen_token: opened.data.screen_token,
  });
  if (beforeClaim.error) throw beforeClaim.error;
  assert(beforeClaim.data.paired === false, "an unclaimed projector reports itself unpaired");
  assert(beforeClaim.data.game_selected === false, "and reports that no game is chosen");

  const claimed = await host.client.rpc("game_pairing_claim", { p_token: opened.data.token, p_game_id: gameId });
  if (claimed.error) throw claimed.error;
  const sessionId = claimed.data.session_id;
  const joinToken = claimed.data.join_token;
  assert(/^[0-9]{6}$/.test(claimed.data.join_code), "the host receives a six-digit join code");
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(joinToken), "and the join QR carries no database id");

  const replay = await host.client.rpc("game_pairing_claim", { p_token: opened.data.token, p_game_id: gameId });
  assert(Boolean(replay.error), "a pairing code cannot be claimed twice");

  const afterClaim = await screen.rpc("game_screen_snapshot", {
    p_session_id: sessionId, p_screen_token: opened.data.screen_token,
  });
  if (afterClaim.error) throw afterClaim.error;
  assert(afterClaim.data.paired === true, "and reports itself paired once a phone claims it");
  assert(afterClaim.data.game_selected === true, "and that the game is chosen");

  // The host who walks up to a screen without having picked a game yet gets a
  // list; it must contain only what game_can_host() will actually accept.
  const hostable = await host.client.rpc("game_hostable_list");
  if (hostable.error) throw hostable.error;
  const listed = hostable.data ?? [];
  assert(listed.some((row) => row.id === gameId), "the host's picker offers their own ready game");
  assert(!listed.some((row) => row.id === badGame.data.id), "and never offers a game with no questions");
  assert(listed.every((row) => row.source !== undefined), "and groups every row by where it came from");

  /* ------------------------------------------------------------ the room */

  console.log(`Joining ${PLAYER_COUNT} players at once…`);
  const players = [];
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    const player = await makeUser(`player${index}`);
    created.push(player.id);
    players.push(player);
  }

  // All at once, which is what a scanned QR in a lecture hall actually looks
  // like: the unique (session_id, user_id) key is what has to hold.
  const joins = await Promise.all(players.map((player, index) =>
    player.client.rpc("game_join", { p_join_token: joinToken, p_nickname: `O‘quvchi ${index + 1}`, p_avatar_id: index % 40 })));
  const failedJoins = joins.filter((result) => result.error);
  assert(failedJoins.length === 0, `all ${PLAYER_COUNT} players joined without error`);

  // The same player scanning twice must not become two players.
  const rejoin = await players[0].client.rpc("game_join", {
    p_join_token: joinToken, p_nickname: "O‘quvchi 1", p_avatar_id: 7,
  });
  if (rejoin.error) throw rejoin.error;
  assert(rejoin.data.player_id === joins[0].data.player_id, "rescanning reconnects the same player");

  const roster = await service.from("game_players").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  assert(roster.count === PLAYER_COUNT, `the roster holds exactly ${PLAYER_COUNT} players, not one more`);

  /* ----------------------------------------------------- the reward hold */

  console.log("Pricing the reward plan before anything is shown…");
  const wallet = await service.from("credit_wallets").upsert({ user_id: host.id, balance: 60 }).select("balance").single();
  if (wallet.error) throw wallet.error;

  // 10 + 9 + 8 + 30 × 1 = 57, which fits in 60.
  const planned = await host.client.rpc("game_session_configure", {
    p_session_id: sessionId,
    p_reward_plan: { first: 10, second: 9, third: 8, participant: 1 },
  });
  if (planned.error) throw planned.error;

  // The remote renders its switches from this, so their absence is a bug the
  // host sees as a checkbox that will not stay ticked.
  const toggled = await host.client.rpc("game_session_configure", {
    p_session_id: sessionId, p_show_on_phones: false, p_sound_enabled: false,
  });
  if (toggled.error) throw toggled.error;
  assert(
    toggled.data.show_on_phones === false && toggled.data.sound_enabled === false,
    "the host state reports the lobby switches back",
  );
  const restoredFlags = await host.client.rpc("game_session_configure", {
    p_session_id: sessionId, p_show_on_phones: true, p_sound_enabled: true,
  });
  if (restoredFlags.error) throw restoredFlags.error;

  const tooBig = await host.client.rpc("game_session_configure", {
    p_session_id: sessionId,
    p_reward_plan: { first: 10, second: 9, third: 8, participant: 2 },
  });
  if (tooBig.error) throw tooBig.error;
  const refusedStart = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
  assert(Boolean(refusedStart.error), "a plan beyond the balance refuses to start the match");
  assert(
    String(refusedStart.error.message).includes("kerak"),
    "and says how much is needed rather than failing anonymously",
  );

  const restored = await host.client.rpc("game_session_configure", {
    p_session_id: sessionId,
    p_reward_plan: { first: 10, second: 9, third: 8, participant: 1 },
  });
  if (restored.error) throw restored.error;

  const started = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
  if (started.error) throw started.error;
  assert(started.data.status === "countdown", "the match starts into a countdown");

  const held = await service.from("credit_wallets").select("balance, reserved").eq("user_id", host.id).single();
  assert(held.data.reserved === 57, "the hold is the worst case: 10 + 9 + 8 + 30 participation coins");
  assert(held.data.balance === 3, "and it left the spendable balance");

  const lateJoiner = await makeUser("late");
  created.push(lateJoiner.id);
  const late = await lateJoiner.client.rpc("game_join", { p_join_token: joinToken, p_nickname: "Kechikkan", p_avatar_id: 1 });
  if (late.error) throw late.error;
  const lateRow = await service.from("game_players").select("reward_eligible").eq("id", late.data.player_id).single();
  assert(lateRow.data.reward_eligible === false, "someone joining after the hold cannot outgrow it");

  // From here on the late joiner is one of the room: the auto-close rule is
  // "everyone present has answered", so leaving them out would keep every
  // question open until its deadline.
  const room = [...players, lateJoiner];

  /* --------------------------------------------------------- the answers */

  console.log("Running the questions…");
  const correctPayloads = [{ choice: "a" }, { value: true }, { text: "  SAMARQAND  " }];

  for (let index = 0; index < questions.length; index += 1) {
    const advanced = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
    if (advanced.error) throw advanced.error;
    assert(advanced.data.status === "question", `question ${index + 1} opens`);

    if (index === 0) {
      // The answer key must not be reachable by anyone playing.
      const peek = await players[0].client.from("game_questions").select("config").eq("game_id", gameId);
      assert((peek.data ?? []).length === 0, "a player cannot select the question table at all");

      const state = await players[0].client.rpc("game_player_state", { p_session_id: sessionId });
      if (state.error) throw state.error;
      assert(state.data.question.config.correct === undefined, "and the live question arrives without its answer");
      assert(Array.isArray(state.data.question.config.options), "while still carrying the options to press");

      const stranger = await lateJoiner.client.rpc("game_host_state", { p_session_id: sessionId });
      assert(Boolean(stranger.error), "a player cannot read the host's private session state");
    }

    // Everyone but the last three (and the late joiner) answers correctly, so
    // the podium is decided by score rather than by luck.
    const wrong = index === 0 ? { choice: "b" } : index === 1 ? { value: false } : { text: "Buxoro" };
    const answers = await Promise.all(room.map((player, playerIndex) =>
      player.client.rpc("game_submit_answer", {
        p_session_id: sessionId,
        p_question_index: index,
        p_payload: playerIndex < PLAYER_COUNT - 3 ? correctPayloads[index] : wrong,
      })));
    const failedAnswers = answers.filter((result) => result.error);
    assert(failedAnswers.length === 0, `all ${room.length} answers to question ${index + 1} were accepted`);
    assert(
      answers.every((result) => result.data.is_correct === undefined),
      "and no verdict came back at submit time",
    );

    if (index === 0) {
      const second = await players[0].client.rpc("game_submit_answer", {
        p_session_id: sessionId, p_question_index: 0, p_payload: { choice: "d" },
      });
      if (second.error) throw second.error;
      const rows = await service.from("game_answers").select("id", { count: "exact", head: true })
        .eq("session_id", sessionId).eq("question_index", 0);
      assert(rows.count === room.length, "a double tap is still one answer");
    }

    // The room answering in full closes the question by itself.
    const afterAnswers = await host.client.rpc("game_host_state", { p_session_id: sessionId });
    if (afterAnswers.error) throw afterAnswers.error;
    assert(afterAnswers.data.status === "question_result", "the room answering in full closes the question");

    const graded = await service.from("game_answers")
      .select("is_correct").eq("session_id", sessionId).eq("question_index", index);
    const correctCount = (graded.data ?? []).filter((row) => row.is_correct).length;
    assert(correctCount === PLAYER_COUNT - 3, `the server graded question ${index + 1} itself`);
    assert(
      (graded.data ?? []).filter((row) => row.is_correct === false).length === 4,
      "and marked the four wrong answers wrong",
    );

    if (index === 2) {
      const normalised = await service.from("game_answers")
        .select("is_correct, payload").eq("session_id", sessionId).eq("question_index", 2).limit(1).single();
      assert(
        normalised.data.is_correct === true && normalised.data.payload.text.includes("SAMARQAND"),
        "and accepted a typed answer despite case and stray spaces",
      );
    }

    const toBoard = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
    if (toBoard.error) throw toBoard.error;
    assert(toBoard.data.status === "leaderboard", `question ${index + 1} yields to the scoreboard`);
  }

  /* --------------------------------------------------------- the podium */

  console.log("Finishing and settling…");
  const finished = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
  if (finished.error) throw finished.error;
  assert(finished.data.status === "finished", "the last scoreboard finishes the match");

  const impossible = await host.client.rpc("game_session_advance", { p_session_id: sessionId, p_action: "next" });
  assert(Boolean(impossible.error), "a finished match cannot go back to a question");

  const ranks = await service.from("game_players").select("user_id, rank, total_score")
    .eq("session_id", sessionId).order("rank");
  const podium = (ranks.data ?? []).filter((row) => row.rank <= 3);
  assert(podium.length === 3, "three places are ranked");
  assert(podium.every((row) => row.total_score > 0), "and every winner scored on the server");

  const settlement = finished.data.settlement;
  // The late joiner ranks on the podium screen but is not reward-eligible: the
  // hold was priced on the lobby, so the payout is the three podium prizes plus
  // one coin for each of the thirty people who were in it.
  assert(settlement.paid === 10 + 9 + 8 + PLAYER_COUNT, "the payout is the podium plus one coin per eligible player");
  assert(settlement.paid <= 57, "and never exceeds the hold, whoever joined late");

  // Every account opens with welcome credits, so the balance is not the tell —
  // the absence of a reward row in the ledger is.
  const lateRewards = await service.from("credit_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", lateJoiner.id).eq("type", "game_reward");
  assert(lateRewards.count === 0, "someone who joined after the hold receives nothing from it");
  assert(settlement.released === 57 - settlement.paid, "and the unused remainder went back");

  const afterSettle = await service.from("credit_wallets").select("balance, reserved").eq("user_id", host.id).single();
  assert(afterSettle.data.reserved === 0, "no coins are left in limbo");
  assert(afterSettle.data.balance === 60 - settlement.paid, "and the host paid exactly what the plan promised");

  const winnerRewards = await service.from("credit_transactions").select("amount")
    .eq("user_id", podium[0].user_id).eq("type", "game_reward").order("amount", { ascending: false });
  assert(
    (winnerRewards.data ?? []).map((row) => row.amount).join(",") === "10,1",
    "first place received the podium prize and the participation coin, as two ledger rows",
  );

  const retry = await service.rpc("game_rewards_settle", { p_session_id: sessionId });
  if (retry.error) throw retry.error;
  assert(retry.data.already === true, "a retried settlement pays nothing a second time");

  const ledgerAfterRetry = await service.from("credit_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", podium[0].user_id).eq("type", "game_reward");
  assert(ledgerAfterRetry.count === 2, "and the retry added no third row");

  // Read as the winner rather than as the service role: `notifications` grants
  // SELECT to `authenticated` only, and what matters is what the person sees.
  const winnerClient = room.find((player) => player.id === podium[0].user_id)?.client;
  if (!winnerClient) throw new Error("the ranked winner is not one of the test players");
  const notified = await winnerClient.from("notifications").select("kind")
    .in("kind", ["game_reward", "game_result"]);
  if (notified.error) throw notified.error;
  const kinds = new Set((notified.data ?? []).map((row) => row.kind));
  assert(kinds.has("game_result"), "the winner was told they placed");
  assert(kinds.has("game_reward"), "and that the coins arrived");

  /* ------------------------------------------------ cancellation refunds */

  console.log("Cancelling a match with a hold…");
  const second = await host.client.rpc("game_session_create", { p_game_id: gameId });
  if (second.error) throw second.error;
  const secondId = second.data.session_id;
  await service.from("credit_wallets").update({ balance: 50 }).eq("user_id", host.id);
  const cancelPlan = await host.client.rpc("game_session_configure", {
    p_session_id: secondId, p_reward_plan: { first: 5, participant: 1 },
  });
  if (cancelPlan.error) throw cancelPlan.error;
  const onePlayer = await players[0].client.rpc("game_join", {
    p_join_token: second.data.join_token, p_nickname: "Yakka", p_avatar_id: 2,
  });
  if (onePlayer.error) throw onePlayer.error;
  const secondStart = await host.client.rpc("game_session_advance", { p_session_id: secondId, p_action: "next" });
  if (secondStart.error) throw secondStart.error;
  const heldAgain = await service.from("credit_wallets").select("balance, reserved").eq("user_id", host.id).single();
  assert(heldAgain.data.reserved === 6, "a second match takes its own hold");

  const cancelled = await host.client.rpc("game_session_advance", { p_session_id: secondId, p_action: "cancel" });
  if (cancelled.error) throw cancelled.error;
  const refunded = await service.from("credit_wallets").select("balance, reserved").eq("user_id", host.id).single();
  assert(refunded.data.reserved === 0, "cancelling returns the whole hold");
  assert(refunded.data.balance === 50, "and the balance is exactly what it was before");

  /* ------------------------------------------------------- join fallback */

  console.log("Checking the join-code fallback and the landing page…");
  const info = await screen.rpc("game_join_info", { p_join_token: joinToken });
  if (info.error) throw info.error;
  assert(info.data.join_code === claimed.data.join_code, "the landing page can read the code a signed-out reader needs");
  assert(info.data.open === false, "and says a finished match is closed");

  const byCode = await lateJoiner.client.rpc("game_join_by_code", {
    p_code: second.data.join_code, p_nickname: "Kod bilan", p_avatar_id: 3,
  });
  assert(Boolean(byCode.error), "a cancelled match refuses a join by code");

  const nonsense = await lateJoiner.client.rpc("game_join_by_code", {
    p_code: "000001", p_nickname: "Yo‘q", p_avatar_id: 0,
  });
  assert(Boolean(nonsense.error), "and an unknown code finds nothing");

  console.log("\nO‘yingoh smoke test passed.");
} finally {
  for (const id of created) {
    await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
}
