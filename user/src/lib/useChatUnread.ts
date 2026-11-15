import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { followInbox, unreadTotal } from "@/lib/chat";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Unread chat messages, muted conversations aside: the number on the tab.
 *
 * Read again when a message arrives anywhere, when the app comes back to the
 * front, and every half minute — reading a conversation lowers it, and that
 * happens on another screen.
 */
export function useChatUnread(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const read = () => { void unreadTotal().then((value) => { if (alive) setCount(value); }).catch(() => undefined); };
    read();
    const channel = followInbox(read);
    const timer = setInterval(read, 30_000);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") read(); });
    return () => {
      alive = false;
      clearInterval(timer);
      listener.remove();
      void supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}
