import { useEffect, useState } from 'react';

/**
 * What the offline queue did, last time it ran.
 *
 * The queue is the app's most important reliability feature — a check-in tapped
 * at a congested mass start is stored and replayed later — and it was
 * completely silent. `flush().catch(() => {})` at the root discarded both the
 * result and any error, so a member whose check-in synced twenty minutes later
 * on the drive home was never told. They spent the week believing they had
 * missed a run they had actually attended.
 *
 * A store rather than a return value because the flush happens at the root, on
 * app foreground, and the thing that should say so is a screen. Deliberately
 * tiny: one value, one subscriber list, no dependency.
 */
export type SyncResult = { synced: number; remaining: number; failed?: boolean };

let last: SyncResult | null = null;
const listeners = new Set<(r: SyncResult | null) => void>();

export function publishSync(result: SyncResult): void {
  last = result;
  listeners.forEach((l) => l(result));
}

/** Called once the member has been told, so it does not reappear on every focus. */
export function clearSync(): void {
  last = null;
  listeners.forEach((l) => l(null));
}

export function useLastSync(): SyncResult | null {
  const [value, setValue] = useState<SyncResult | null>(last);

  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
