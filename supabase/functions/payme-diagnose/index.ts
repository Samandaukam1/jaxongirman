import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { credentialShape, fingerprint, missingPaymeVariables, paymeConfig, probePaymeCredentials } from "../_shared/payment-provider.ts";

/**
 * Why Payme is refusing us, answered without charging anybody.
 *
 * `receipts.create` succeeds and `receipts.pay` comes back -32504, with the
 * same `X-Auth: <merchant_id>:<key>` on both. That is only strange until you
 * notice that Payme documents `receipts.create` as reachable from the checkout
 * page — the merchant id alone can be enough for it. If so, a create that works
 * proves nothing about the key, and every method that does check the key will
 * refuse us in exactly the way `receipts.pay` does.
 *
 * This runs three probes and reports what Payme actually said to each, so the
 * question stops being a matter of opinion:
 *
 *   1. `receipts.create` with `id:key`   — the call known to work.
 *   2. `receipts.create` with `id` alone — does create check the key at all?
 *   3. `receipts.check`  with `id:key`   — a method that needs the key and
 *                                          takes no money.
 *
 * If (2) succeeds, (1) was never evidence. If (3) returns -32504, the key is
 * what is wrong, and no amount of work on `receipts.pay` will help. If (3)
 * succeeds, merchant-scope authentication is fine and the refusal really is
 * specific to `receipts.pay` — a merchant cabinet matter, with the probe output
 * as the thing to send Payme.
 *
 * Admin only, and it never returns a key, an assembled X-Auth or a card token.
 */
Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const { data: isAdmin, error: roleError } = await context.userClient.rpc("is_admin");
    if (roleError) throw roleError;
    if (isAdmin !== true) throw new HttpError(403, "Admin role required", "forbidden");

    const config = paymeConfig();
    if (!config) {
      const missing = missingPaymeVariables();
      throw new HttpError(
        503,
        `Payme credential o‘rnatilmagan. Yetishmayotgan o‘zgaruvchi(lar): ${missing.join(", ")}`,
        "provider_unconfigured",
      );
    }

    const probes = await probePaymeCredentials(config);

    // The reading, stated rather than left for someone to infer from three rows.
    const createWithKey = probes.find((p) => p.step.startsWith("receipts.create (id:key)"));
    const createIdOnly = probes.find((p) => p.step.startsWith("receipts.create (faqat id)"));
    const check = probes.find((p) => p.step.startsWith("receipts.check"));

    let verdict: string;
    if (!createWithKey?.ok) {
      verdict = "receipts.create ham o‘tmadi — muammo kalitdan oldinroq:"
        + " merchant ID yoki endpoint noto‘g‘ri bo‘lishi mumkin.";
    } else if (check?.ok) {
      verdict = "Kalit merchant-scope metodlar uchun QABUL QILINDI (receipts.check o‘tdi)."
        + " Demak muammo kalitda emas, aynan receipts.pay huquqida — bu Payme kabinetidagi masala."
        + " Shu natijani Payme yordamiga yuboring.";
    } else if (check?.providerCode === -32504 && String(check.providerData ?? "").includes("invalid_key")) {
      verdict = "Payme aniq aytdi: kalit noto‘g‘ri (invalid_key)."
        + " PAYME_SUBSCRIBE_KEY ni Payme kabinetidagi joriy Subscribe kaliti bilan almashtiring."
        + " receipts.create kalitni tekshirmagani uchun ishlab turgan edi.";
    } else if (check?.providerCode === -32504) {
      verdict = "receipts.check ham -32504 qaytardi — kalit merchant-scope metodlar uchun QABUL QILINMAYAPTI."
        + (createIdOnly?.ok
          ? " Va create kalitsiz ham o‘tdi, ya’ni uning ishlashi kalit to‘g‘ri degani emas edi."
          : "")
        + " PAYME_SUBSCRIBE_KEY ni Payme kabinetidagi joriy kalit bilan almashtiring.";
    } else {
      verdict = "receipts.check boshqa xato qaytardi — quyidagi providerCode va providerData ni ko‘ring.";
    }

    return json({
      // Safe context only: no key, no X-Auth, no token.
      endpoint: config.endpoint,
      environment: config.environment,
      merchant: `…${config.merchantTail}`,
      // Shape, never value. Enough to tell "wrong key" from "right key, stored
      // with the quotes still on it".
      merchantIdShape: credentialShape(config.merchantId),
      keyShape: credentialShape(config.key),
      // Which variable each value actually came from, and whether it needed
      // trimming — the two things a fallback chain hides.
      source: config.source,
      trimmed: config.trimmed,
      // Comparable against the digest the hosting platform reports for the
      // stored secret. Equal means this runtime is current.
      keyFingerprint: await fingerprint(config.key),
      merchantFingerprint: await fingerprint(config.merchantId),
      probes,
      verdict,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
