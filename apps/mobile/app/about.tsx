import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { adamSays, colors, radius, spacing, BUILD_FACTS, CONTACT_LINKS, SIGNATURE, TAGLINE } from '@mvmnt/shared';
import { RELEASE_NOTES } from '@/lib/releaseNotes';

/**
 * Who made this.
 *
 * The old "made by" signature from games, in the one place it belongs: a page
 * somebody chooses to open. Everywhere else in the app the voice is a line
 * here and there; this is where the whole answer lives, so nothing else has to
 * carry it.
 *
 * The contact links are PLACEHOLDERS and say so on screen. A plausible-looking
 * URL that 404s in front of 300 members is worse than an obviously unfinished
 * one, so they are visibly wrong until they are filled in.
 */
export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '0.1.0';
  const [taps, setTaps] = useState(0);
  const found = taps >= 7;
  const lastTap = useRef(0);
  const [linkError, setLinkError] = useState<string | null>(null);

  /**
   * Seven taps on the wordmark.
   *
   * Costs nothing, is impossible to hit by accident, and is the kind of thing
   * somebody screenshots. Resets if the taps are slow, so a member idly
   * prodding the logo over a minute does not stumble into it.
   */
  function tapWordmark() {
    const now = Date.now();
    setTaps((n) => (now - lastTap.current > 1200 ? 1 : n + 1));
    lastTap.current = now;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={tapWordmark} accessibilityRole="header">
        <View style={styles.hero}>
          <Text style={styles.wordmark}>MVMNT</Text>
          <Text style={styles.tagline}>{TAGLINE}</Text>
        </View>
      </Pressable>

      {found && (
        <View style={styles.egg}>
          <Text style={styles.eggTitle}>🕵️ {adamSays('secret_found', { noSurprises: true })}</Text>
          <Text style={styles.eggBody}>
            Worth absolutely nothing. Congratulations anyway.
          </Text>
          <View style={styles.eggStats}>
            <Text style={styles.eggStat}>Build {version}</Text>
            <Text style={styles.eggStat}>{RELEASE_NOTES.length} releases so far</Text>
            <Text style={styles.eggStat}>Built between lectures and Saturdays</Text>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.builtBy}>Built by</Text>
        <Text style={styles.name}>{SIGNATURE.name}</Text>
        <Text style={styles.role}>{SIGNATURE.role}</Text>
        <Text style={styles.study}>{SIGNATURE.study}</Text>
        <Text style={styles.study}>{SIGNATURE.location}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.body}>
          MVMNT ran on WhatsApp threads, Instagram stories and word of mouth — three hundred people
          every Saturday, and once two and a half thousand on one start line. This app is that,
          without the group chat.
        </Text>
        <Text style={styles.body}>
          It was built for the club rather than sold to it. Every rule that matters — who gets a
          place, who is on the waitlist, what counts as being there — lives in one place and is
          tested, so the app you use on a Saturday morning does the same thing every Saturday
          morning.
        </Text>
        <Text style={styles.body}>{SIGNATURE.hello}</Text>
      </View>

      {/*
        The part that does the actual work.
        =================================
        The owner is building MVMNT unpaid, and the return on it is this: a
        member who likes the app wonders who made it, and finds a straight
        answer plus a way to ask. So this says what was built and what he is
        open to — plainly, once, without a sales voice. The rest of the app
        keeps the club as the star; a member who never opens this page is
        never sold anything.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What went into it</Text>
        <View style={styles.facts}>
          {BUILD_FACTS.map((fact) => (
            <View key={fact.label} style={styles.fact}>
              <Text style={styles.factValue}>{fact.value}</Text>
              <Text style={styles.factLabel}>{fact.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.body}>
          Two apps and a database: an iPhone and Android app, a console the organisers run the club
          from with no developer involved, and a set of rules that live in the database so a bug in
          a screen can never hand out somebody else&rsquo;s data or oversell a run.
        </Text>
        <Text style={styles.body}>
          Adam builds software like this — mobile apps, web tools, and the unglamorous parts
          underneath that decide whether a thing still works at three hundred people. If you have
          something that needs building, the links below reach him.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Get in touch</Text>
        {/* Placeholder links used to render as tappable rows that did
            nothing — the same non-functional-UI problem as the sign-in
            stubs, and the audit flagged both. Unfilled links now simply do
            not render; the row appears the day the URL does. */}
        {CONTACT_LINKS.filter((link) => !link.placeholder).map((link) => (
          <Pressable
            key={link.label}
            style={styles.link}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            onPress={async () => {
              // Placeholders are deliberately not opened — sending somebody to a
              // dead address is worse than the button doing nothing.
              if (link.placeholder) return;
              // openURL rejects when nothing can handle the scheme (no mail
              // client, for instance). Unguarded, that is one more button that
              // silently does nothing.
              const opened = await Linking.openURL(link.url).then(
                () => true,
                () => false,
              );
              if (!opened) setLinkError(`Could not open ${link.label}. The address is ${link.url}`);
            }}
          >
            <Text style={styles.linkLabel}>{link.label}</Text>
            <Text style={styles.linkValue}>
              {link.placeholder ? 'coming soon' : link.url.replace(/^(https?:\/\/|mailto:)/, '')}
            </Text>
          </Pressable>
        ))}
        {linkError && <Text style={styles.linkError}>{linkError}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Adam&apos;s notes</Text>
        <Text style={styles.hint}>
          {adamSays('whats_new', { stability: 'daily' })} What changed, in plain English rather than
          a version number.
        </Text>
        {RELEASE_NOTES.map((release) => (
          <View key={release.version} style={styles.release}>
            <View style={styles.releaseHead}>
              <Text style={styles.releaseTitle}>{release.title}</Text>
              <Text style={styles.releaseVersion}>{release.version}</Text>
            </View>
            {release.notes.map((note) => (
              <Text key={note} style={styles.releaseNote}>
                · {note}
              </Text>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>The people behind MVMNT</Text>
        <Text style={styles.body}>
          <Text style={styles.creditName}>{SIGNATURE.name}</Text> — {SIGNATURE.role}
          {'\n'}
          <Text style={styles.creditName}>The organisers</Text> — who show up early and count
          everybody in
          {'\n'}
          <Text style={styles.creditName}>Everyone who runs</Text> — who are the actual club
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.signature}>{SIGNATURE.footer}</Text>
        <Text style={styles.version}>Version {version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  fact: { minWidth: 92 },
  factValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  factLabel: { fontSize: 11, color: colors.textSecondary },
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  hero: { alignItems: 'center', paddingVertical: spacing.lg, gap: 2 },
  wordmark: { fontSize: 40, fontWeight: '900', color: colors.textOnDark, letterSpacing: 6 },
  tagline: { fontSize: 15, color: colors.textOnDarkMuted },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  builtBy: {
    fontSize: 12,
    color: colors.textOnDarkMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  name: { fontSize: 26, fontWeight: '900', color: colors.textOnDark, letterSpacing: -0.4 },
  role: { fontSize: 14, color: colors.action, fontWeight: '700' },
  study: { fontSize: 13, color: colors.textOnDarkMuted, marginTop: 4 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  body: { fontSize: 15, color: colors.textOnDarkMuted, lineHeight: 23 },
  link: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  linkLabel: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  linkValue: { fontSize: 13, color: colors.textOnDarkMuted },
  hint: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  linkError: { fontSize: 13, color: colors.highlight, lineHeight: 19 },
  egg: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.highlight,
    padding: spacing.md,
    gap: spacing.xs,
  },
  eggTitle: { fontSize: 17, fontWeight: '800', color: colors.highlight },
  eggBody: { fontSize: 14, color: colors.textOnDarkMuted },
  eggStats: { marginTop: spacing.sm, gap: 2 },
  eggStat: { fontSize: 13, color: colors.textOnDarkMuted },
  release: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  releaseHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  releaseTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark, flex: 1 },
  releaseVersion: { fontSize: 12, color: colors.textOnDarkMuted },
  releaseNote: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
  creditName: { color: colors.textOnDark, fontWeight: '700' },
  footer: { alignItems: 'center', gap: 4, marginTop: spacing.lg },
  signature: { fontSize: 14, color: colors.textOnDarkMuted },
  version: { fontSize: 12, color: colors.textOnDarkMuted, opacity: 0.7 },
});
