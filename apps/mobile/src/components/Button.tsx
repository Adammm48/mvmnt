import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, MIN_TOUCH_TARGET } from '@mvmnt/shared';

type Variant = 'primary' | 'secondary' | 'quiet' | 'destructive';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Screen-reader description when the label alone is not self-explanatory. */
  accessibilityHint?: string;
};

/**
 * App Spec §2: exactly one primary action per screen. `primary` is the coral
 * CTA and should appear once — a second one on the same screen means neither
 * reads as "the" next step.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityHint,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {loading && (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? colors.textOnAction : colors.textOnDark}
          />
        )}
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primary: { backgroundColor: colors.action },
  // Every screen in the app sits on the dark `base` background (App Spec §2
  // makes charcoal-navy the base for long scrolling sessions), so the non-primary
  // variants are styled for a dark surface. Using the light-surface text colour
  // here renders charcoal on charcoal — invisible, and a contrast failure under
  // Principles §5.
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.borderStrong },
  quiet: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.alert },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  label: { fontSize: 16, fontWeight: '700' },
  primaryLabel: { color: colors.textOnAction },
  secondaryLabel: { color: colors.textOnDark },
  quietLabel: { color: colors.textOnDarkMuted },
  destructiveLabel: { color: '#FF7A6E' },
});
