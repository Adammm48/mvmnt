export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
};

type Handler = (request: ConfirmRequest, resolve: (ok: boolean) => void) => void;

let handler: Handler | null = null;

/**
 * Called once by <ConfirmHost /> at the root. Returns its own unregister so the
 * host can clean up, which matters under fast refresh — a stale handler
 * pointing at an unmounted component would resolve nothing and hang the caller.
 */
export function registerConfirmHost(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Ask before something irreversible.
 *
 * Drawn by the app rather than by the platform, on every platform. Two
 * successive attempts to use a platform dialog here failed the same way — by
 * doing nothing and saying nothing:
 *
 *   · react-native-web's Alert is `static alert() {}`. It shows nothing and
 *     calls nothing back.
 *   · window.confirm, which replaced it, is suppressed by browsers in embedded
 *     contexts and returns **false** when suppressed. The caller reads that as
 *     "the member declined" and does nothing, so the button looks broken.
 *
 * The second one is why "Turn off my code" appeared dead, and it was doing the
 * same to "Delete my account" and "Remove friend" on the web build without
 * anybody noticing — a destructive action that silently does nothing is the
 * worst possible failure mode, because it looks identical to being careful.
 *
 * Defaults to **false** if no host is mounted. If the confirmation cannot be
 * shown, the safe answer to "are you sure?" is no.
 */
export function confirmDestructive(request: ConfirmRequest): Promise<boolean> {
  if (!handler) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => handler!(request, resolve));
}
