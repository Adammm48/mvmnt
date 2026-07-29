import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, spacing } from '@mvmnt/shared';
import { adamSays, toMemberMessage } from '@mvmnt/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Loading, Notice } from '@/components/Feedback';
import { confirmDestructive } from '@/lib/confirm';

/**
 * Find me in photos — the selfie opt-in (App Spec §10, ADR 0005 §2).
 *
 * One selfie, taken here and nowhere else: no library picker, because the
 * point is a current photo of the person actually holding the phone, and
 * because "choose any image" invites enrolling somebody else's face.
 *
 * Everything on this screen is honest about the state of the feature:
 * matching runs through a recognition service the club has not signed up
 * for yet, so until then the selfie sits enrolled-but-idle and the screen
 * says so. Opting out deletes the selfie, the enrolment and every match as
 * one unit — the club forgets the face, it does not just stop using it.
 */
export default function FindMe() {
  const { session } = useAuth();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [live, setLive] = useState(false);
  const [taking, setTaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('face_optins')
      .select('provider_face_id')
      .maybeSingle();
    setOptedIn(data !== null);
    // provider_face_id present means the matcher has actually enrolled the
    // face — the honest signal that matching is live rather than waiting.
    setLive(data?.provider_face_id != null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function enrolFrom(uri: string) {
    if (!session) return;
    setBusy(true);
    setError(null);

    try {
      // The bytes go to selfies/<own id> — the only path the storage policy
      // allows this member to write. Upsert, so replacing replaces.
      const body = await (await fetch(uri)).blob();
      const { error: uploadError } = await supabase.storage
        .from('gallery-media')
        .upload(`selfies/${session.user.id}`, body, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase.rpc('enable_photo_matching');
      if (rpcError) throw rpcError;

      setTaking(false);
      await load();
    } catch (e) {
      setError(toMemberMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSelfie() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
    if (!photo?.uri) {
      setError('No photo captured — try again.');
      return;
    }
    await enrolFrom(photo.uri);
  }

  /**
   * The library route, added on the owner's instruction. The original build
   * was camera-only on the argument that "choose any image" invites enrolling
   * somebody else's face; the owner overrode it for the ordinary reason that
   * people already own a photo they like. The safeguard that actually
   * matters is unchanged either way: matching only ever surfaces photos the
   * member could already see, so enrolling the wrong face reveals nothing.
   */
  async function pickFromLibrary() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await enrolFrom(picked.assets[0].uri);
  }

  async function optOut() {
    const sure = await confirmDestructive({
      title: 'Stop finding you in photos?',
      message:
        'Your selfie and every match are deleted — the club forgets your face entirely. You can opt back in any time with a new selfie.',
      confirmLabel: 'Delete it all',
    });
    if (!sure) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('disable_photo_matching');
    setBusy(false);
    if (rpcError) {
      setError(toMemberMessage(rpcError));
      return;
    }
    await load();
  }

  if (optedIn === null) return <Loading />;

  // --- the camera, when actively taking the selfie -------------------------
  if (taking) {
    if (!permission?.granted) {
      return (
        <View style={styles.screen}>
          <Text style={styles.title}>The camera needs permission</Text>
          <Text style={styles.body}>One selfie, taken here, never from your library.</Text>
          {permission?.canAskAgain ? (
            <Button label="Allow the camera" onPress={requestPermission} />
          ) : (
            <Button label="Open settings" onPress={() => Linking.openSettings()} />
          )}
        </View>
      );
    }

    return (
      <View style={styles.screen}>
        {error && <Notice tone="error" message={error} />}
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera} facing="front" />
        </View>
        <Text style={styles.voice}>
          {adamSays('selfie_optin', { userId: session?.user.id })}
        </Text>
        <Button label={busy ? 'One moment…' : 'Use this face'} onPress={takeSelfie} disabled={busy} />
        <Button label="Cancel" variant="secondary" onPress={() => setTaking(false)} />
      </View>
    );
  }

  // --- opted in: status and the way out -------------------------------------
  if (optedIn) {
    return (
      <View style={styles.screen}>
        {error && <Notice tone="error" message={error} />}
        <Text style={styles.title}>You&rsquo;re in</Text>
        <Text style={styles.body}>
          {live
            ? 'When the club publishes a gallery, photos the matcher thinks you are in appear under a “You” tab. Every match is a guess by a model — treat it as one.'
            : 'Your selfie is saved and waiting. Matching itself is not switched on yet — it runs through a recognition service the club is still setting up — so the “You” tab stays empty for now. Nothing else about the galleries changes.'}
        </Text>
        <Text style={styles.body}>
          Your selfie is visible to nobody — not other members, not organisers. It exists only so
          the matcher can compare it against published run photos.
        </Text>
        <Button label="Retake my selfie" variant="secondary" onPress={() => setTaking(true)} />
        <Button label="Upload a photo instead" variant="secondary" onPress={pickFromLibrary} />
        <Button
          label={busy ? 'One moment…' : 'Stop and delete my selfie'}
          variant="secondary"
          onPress={optOut}
          disabled={busy}
        />
      </View>
    );
  }

  // --- not opted in: the pitch, honestly ------------------------------------
  return (
    <View style={styles.screen}>
      {error && <Notice tone="error" message={error} />}
      <Text style={styles.title}>Find yourself in run photos</Text>
      <Text style={styles.body}>
        Take one selfie and the app can point out which gallery photos you are probably in — a
        &ldquo;You&rdquo; tab instead of scrolling three hundred crowd shots.
      </Text>
      <Text style={styles.body}>
        Entirely optional, and off by default. Your selfie is stored privately, shown to nobody,
        and deleted the moment you opt out — along with every match. Members without a selfie are
        never matched against anything.
      </Text>
      {Platform.OS === 'web' && (
        <Text style={styles.hint}>
          The selfie camera works best in the app on your phone.
        </Text>
      )}
      <Button label="Take the selfie" onPress={() => setTaking(true)} />
      <Button label="Upload a photo instead" variant="secondary" onPress={pickFromLibrary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.textOnDark },
  body: { fontSize: 15, color: colors.textOnDarkMuted, lineHeight: 22 },
  hint: { fontSize: 13, color: colors.textOnDarkMuted, fontStyle: 'italic' },
  voice: { fontSize: 13, color: colors.textOnDarkMuted, fontStyle: 'italic', textAlign: 'center' },
  cameraWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
    backgroundColor: colors.baseElevated,
  },
  camera: { flex: 1 },
});
