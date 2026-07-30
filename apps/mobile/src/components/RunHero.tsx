import { useEffect } from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, formatRunDate, formatRunTime, spacing, type Run } from '@mvmnt/shared';
import { CoverFallback } from './CoverFallback';
import { mediaUri } from '@/lib/media';

/**
 * The run detail hero.
 *
 * Shows the run's clip if there is one, otherwise its cover photo, otherwise a
 * plain panel — the screen must look composed at every level of media, since
 * most runs will have neither at first.
 *
 * The clip is muted and looping. That is not only taste: an autoplaying video
 * with sound in a public place is hostile, so any meaningful audio would have
 * to be behind a control the member chooses to press.
 */
export function RunHero({ run }: { run: Run }) {
  // loop/muted are setup-only and safe inside the creation callback. play()
  // is not: called here it fires before VideoView has mounted an underlying
  // element to play, and nothing retries it — the clip decodes perfectly
  // (readyState 4, no error) but sits frozen on frame 0 forever. Calling
  // play() from an effect instead guarantees the view exists first.
  const player = useVideoPlayer(mediaUri(run.cover_video_url), (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (mediaUri(run.cover_video_url)) player.play();
  }, [player, run.cover_video_url]);

  const overlay = (
    <>
      <View style={styles.scrim} />
      <View style={styles.caption}>
        <View style={styles.datePill}>
          <Text style={styles.dateText}>
            {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)}
          </Text>
        </View>
        <Text style={styles.title}>{run.title}</Text>
      </View>
    </>
  );

  if (mediaUri(run.cover_video_url)) {
    return (
      <View style={styles.hero} accessible accessibilityLabel={`${run.title} preview clip`}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Decorative: no controls and no picture-in-picture, so it can never
          // take over the screen and hide the check-in button underneath.
          nativeControls={false}
          allowsPictureInPicture={false}
          // Without this, Safari on iOS refuses inline playback altogether —
          // it either forces fullscreen or blocks autoplay outright. Easy to
          // miss because nothing errors; the clip just never appears.
          playsInline
        />
        {overlay}
      </View>
    );
  }

  if (mediaUri(run.cover_image_url)) {
    return (
      <ImageBackground source={{ uri: mediaUri(run.cover_image_url)! }} style={styles.hero}>
        {overlay}
      </ImageBackground>
    );
  }

  return (
    <CoverFallback seed={run.id} style={styles.hero}>
      {overlay}
    </CoverFallback>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, justifyContent: 'flex-end', backgroundColor: colors.baseElevated },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(12,14,20,0.40)' },
  caption: { padding: spacing.md, gap: spacing.sm },
  datePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.action,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dateText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 10,
  },
});
