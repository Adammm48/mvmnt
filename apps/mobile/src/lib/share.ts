import { Platform, Share, type View } from 'react-native';
import type { RefObject } from 'react';

/**
 * Turning a card into something a member can post.
 *
 * Two paths, because the platforms genuinely differ rather than because one is
 * a fallback for a broken other:
 *
 *   · Native captures the view as a PNG and hands it to the share sheet, which
 *     is what actually ends up on Instagram.
 *   · Web has no reliable way to rasterise a react-native-web tree, so it shares
 *     text. A text share that works beats an image share that silently fails,
 *     and the web build is a demo surface rather than how the club uses this.
 *
 * Both are wrapped: sharing is cancellable by design — the member closing the
 * sheet is not an error and must not surface as one.
 */
export async function shareStandingCard(
  cardRef: RefObject<View | null>,
  message: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    if (Platform.OS === 'web') {
      await Share.share({ message });
      return { ok: true };
    }

    // Imported lazily so the web bundle never pulls in a native-only module.
    const { captureRef } = await import('react-native-view-shot');
    const Sharing = await import('expo-sharing');

    if (!cardRef.current) return { ok: false, message: 'The card was not ready. Try again.' };

    const uri = await captureRef(cardRef, {
      format: 'png',
      quality: 1,
      // 3x a 360×450 layout is 1080×1350 — Instagram portrait, at a density
      // where the type does not soften.
      result: 'tmpfile',
      width: 1080,
      height: 1350,
    });

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'Share your standing',
    });
    return { ok: true };
  } catch {
    // Cancelling the share sheet throws on some platforms. Treating that as a
    // failure would show an error for a deliberate action.
    return { ok: true };
  }
}
