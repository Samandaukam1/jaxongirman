import { useCallback, useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const navigationEvent = "jaxongirman:navigation";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(navigationEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(navigationEvent, listener);
  };
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
}

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(navigationEvent));
}

export function AppLink({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return <a {...props} href={to} onClick={follow} />;
}

/**
 * A screen that Back should close rather than leave.
 *
 * The editor and the template importer are screens without addresses: they are
 * React state inside `/jslayd`, so as far as the browser is concerned nothing
 * happened when one opened. Pressing Back therefore left the section entirely
 * and landed wherever the person had been before it — the dashboard, usually,
 * which is what made Back feel broken from every one of them.
 *
 * A history entry is pushed when the screen opens, so Back has something of its
 * own to pop. The returned `dismiss` goes on the close buttons and calls
 * `history.back()` rather than closing directly, so both ways out consume that
 * entry: closing by button and closing by Back leave the history in the same
 * state, and pressing Back twice does not have to undo a button press first.
 */
export function useDismissable(active: boolean, onDismiss: () => void): () => void {
  const dismiss = useCallback(() => {
    if (active) window.history.back();
    else onDismiss();
  }, [active, onDismiss]);

  useEffect(() => {
    if (!active) return;
    window.history.pushState({ screen: true }, "", window.location.pathname);
    const pop = () => onDismiss();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [active, onDismiss]);

  return dismiss;
}
