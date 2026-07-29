import { Platform, Share, type View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { RefObject } from 'react';

export type ShareOutcome =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'copied'; message: string }
  | { kind: 'failed'; message: string };

/**
 * Handing a card to whatever the platform can actually do with it.
 *
 * The previous version wrapped everything in `catch { return ok }` so that
 * cancelling the share sheet would not surface as an error. That swallowed
 * "sharing is not available here" identically, and on web — where
 * `navigator.share` is undefined outside a few browsers — the button did
 * nothing at all, silently. Same failure as the confirm dialog and the Alert
 * before it: a platform API that declines quietly, and a caller that believed
 * it had worked.
 *
 * So this reports honestly, and the caller says something either way. Cancelling
 * is its own outcome, not a success and not an error.
 */
export async function shareStandingCard(
  cardRef: RefObject<View | null>,
  message: string,
): Promise<ShareOutcome> {
  if (Platform.OS === 'web') return shareOnWeb(message);
  return shareOnNative(cardRef, message);
}

async function shareOnWeb(message: string): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;

  if (nav?.share) {
    try {
      await nav.share({ title: 'MVMNT', text: message });
      return { kind: 'shared' };
    } catch (e) {
      // AbortError is the member closing the sheet. Anything else is a real
      // failure and should fall through to the clipboard rather than vanish.
      if (e instanceof Error && e.name === 'AbortError') return { kind: 'cancelled' };
    }
  }

  try {
    await Clipboard.setStringAsync(message);
    return {
      kind: 'copied',
      message: 'Copied. Screenshot the card above to post the picture.',
    };
  } catch {
    return {
      kind: 'failed',
      message: 'This browser will not let the app share. Screenshot the card above instead.',
    };
  }
}

async function shareOnNative(
  cardRef: RefObject<View | null>,
  message: string,
): Promise<ShareOutcome> {
  if (!cardRef.current) {
    return { kind: 'failed', message: 'The card was not ready. Try again in a moment.' };
  }

  try {
    // Imported lazily so the web bundle never pulls in native-only modules.
    const { captureRef } = await import('react-native-view-shot');
    const Sharing = await import('expo-sharing');

    const uri = await captureRef(cardRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      // 1080×1350 — Instagram portrait, at a density where the type stays sharp.
      width: 1080,
      height: 1350,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your standing' });
      return { kind: 'shared' };
    }

    // No share sheet, but the image exists — the text share is still better
    // than nothing.
    await Share.share({ message });
    return { kind: 'shared' };
  } catch (e) {
    const name = e instanceof Error ? e.message : '';
    // Both platforms report a dismissed sheet as an error of some kind.
    if (/cancel|dismiss|abort/i.test(name)) return { kind: 'cancelled' };
    return { kind: 'failed', message: 'Could not share that. Screenshot the card instead.' };
  }
}
