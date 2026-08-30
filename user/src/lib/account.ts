import AsyncStorage from "@react-native-async-storage/async-storage";

import { asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Closing an account, from the phone's side of it.
 *
 * The app cannot delete anybody — deleting a user needs the service-role key,
 * and a key that can delete any account is not a key that ships in a binary
 * anybody can download. So this asks, and `delete-account` does it. What is
 * left here is the part only the phone can do: forgetting.
 */

export type DeletionOutcome = {
  /**
   * `deleted` means the `auth.users` row is gone. `anonymised` means a ledger
   * somewhere names this id and the row had to stay to keep the books whole —
   * emptied of everything readable, unable to sign in. See the migration.
   */
  outcome: "deleted" | "anonymised";
  reasons: string[];
  filesRemoved: number;
};

/** The word the server insists on, so a stray POST cannot end an account. */
const CONFIRMATION = "DELETE";

/**
 * Keys holding something about the person rather than about the phone.
 *
 * The theme is deliberately not on this list. Which palette this screen draws
 * in is a property of the screen, not of whoever was signed in on it — wiping
 * it would hand the next person a white flash at midnight to make a point
 * about privacy that the value does not contain.
 */
const PERSONAL_KEYS = ["jaxongirman:recent-fonts"];

export async function deleteMyAccount(): Promise<DeletionOutcome> {
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: { confirm: CONFIRMATION },
  });
  if (error) throw new Error(await asFunctionErrorMessage(error));
  return data as DeletionOutcome;
}

/**
 * Everything this device remembered, dropped.
 *
 * `scope: "local"` rather than a plain sign-out: the server has already revoked
 * every session for this user, so asking it to revoke them again answers with
 * an error about a session that no longer exists — and an error thrown here
 * would leave the app sitting on a dead token on the screen it was already
 * leaving. Nothing on this path is allowed to fail loudly; the account is
 * already gone, and what remains is housekeeping.
 */
export async function forgetLocalAccount(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(PERSONAL_KEYS);
  } catch {
    // A cache, not a record. Losing the attempt costs nothing.
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The token is already void server-side; clearing it locally is the point.
  }
}
