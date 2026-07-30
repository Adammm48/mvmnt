import { supabase } from './supabase';

/**
 * Uploading an image the picker or camera just produced.
 *
 * WHY THIS EXISTS
 *
 * Both upload sites used to do `await (await fetch(uri)).blob()`. That works in
 * a browser, where the picker hands back a `blob:` URL — and it is exactly why
 * this passed every check: all of them ran on the web build. On iOS the picker
 * hands back a `file://` URI, React Native's `fetch` does not read local files
 * reliably, and `.blob()` yields something empty. The upload then SUCCEEDS with
 * a zero-byte object, `set_avatar` succeeds, and the member is left with a
 * profile picture that never appears. Silent, and invisible to the browser.
 *
 * So the bytes come from base64 instead, which both the picker
 * (`base64: true`) and the camera (`takePictureAsync({ base64: true })`) can
 * produce on every platform. One path, no platform branch.
 *
 * No new dependency for the decode: it is fifteen lines of arithmetic, and
 * `Buffer` does not exist in React Native (Principles §1).
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → bytes. Supabase's storage client accepts a Uint8Array directly. */
export function decodeBase64(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array((clean.length * 3) / 4);

  let byte = 0;
  for (let i = 0; i < clean.length; i += 4) {
    // Four base64 characters carry three bytes. A short final group means the
    // input was padded, and the spare bytes simply are not written.
    const chunk =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1]!) << 12) |
      ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);

    bytes[byte++] = (chunk >> 16) & 0xff;
    if (clean[i + 2]) bytes[byte++] = (chunk >> 8) & 0xff;
    if (clean[i + 3]) bytes[byte++] = chunk & 0xff;
  }

  return bytes.subarray(0, byte);
}

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

/**
 * Put an image in a bucket and say plainly whether it worked.
 *
 * Refuses an empty body rather than uploading it. A zero-byte upload is the
 * failure this whole file exists to prevent, and it must never again look like
 * a success.
 */
export async function uploadImage({
  bucket,
  path,
  base64,
  contentType = 'image/jpeg',
}: {
  bucket: string;
  path: string;
  base64: string | null | undefined;
  contentType?: string;
}): Promise<UploadResult> {
  if (!base64) {
    return {
      ok: false,
      message: 'That picture could not be read from your phone. Try another one.',
    };
  }

  const bytes = decodeBase64(base64);
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      message: 'That picture came through empty. Try another one.',
    };
  }

  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, path };
}
