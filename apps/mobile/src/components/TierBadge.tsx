import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';
import { View } from 'react-native';
import { TIER_COLOR, TIER_ORDER, type MemberTier } from '@mvmnt/shared';

/**
 * The medallion for a tier.
 *
 * Drawn rather than shipped as five PNGs. react-native-svg is already a
 * dependency for the friend QR, so this costs nothing to add, scales to any
 * size without a @3x set, and recolours from the same tokens the rest of the
 * app uses — five image files would drift from the palette the first time a
 * tier colour changed.
 *
 * Each tier gets one more point on the star than the last, so they are
 * distinguishable in grey as well as in colour: rank should not be carried by
 * hue alone (Principles §5).
 */
export function TierBadge({
  tier,
  size = 64,
  locked = false,
}: {
  tier: MemberTier;
  size?: number;
  /** Drawn flat and grey — a tier the member has not reached yet. */
  locked?: boolean;
}) {
  const color = locked ? '#4A5165' : TIER_COLOR[tier];
  const rank = TIER_ORDER.indexOf(tier);
  const points = 3 + rank; // 3 for Rookie … 7 for Legend
  const id = `grad-${tier}${locked ? '-locked' : ''}`;

  return (
    <View accessibilityRole="image" accessibilityLabel={`${tier} badge`}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={locked ? 0.35 : 1} />
            <Stop offset="1" stopColor={color} stopOpacity={locked ? 0.15 : 0.55} />
          </LinearGradient>
        </Defs>

        <Circle cx="50" cy="50" r="46" fill="#1B1F2A" stroke={color} strokeWidth="4" opacity={locked ? 0.5 : 1} />
        <Circle cx="50" cy="50" r="37" fill={`url(#${id})`} opacity={locked ? 0.5 : 0.22} />

        <Polygon points={starPoints(points)} fill={`url(#${id})`} stroke={color} strokeWidth="2" opacity={locked ? 0.55 : 1} />

        {/* Legend alone gets the laurel. The top rung should look different in
            kind, not just in colour — otherwise it is only the fifth of five. */}
        {tier === 'legend' && !locked && (
          <>
            <Path d="M22 62 Q14 50 22 38" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
            <Path d="M78 62 Q86 50 78 38" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        )}
      </Svg>
    </View>
  );
}

/** A star with `n` points, centred in the 100×100 viewBox. */
function starPoints(n: number): string {
  const outer = 26;
  const inner = outer * 0.46;
  const cx = 50;
  const cy = 50;
  const coords: string[] = [];

  for (let i = 0; i < n * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    // -90° so a point sits at the top rather than the side.
    const angle = (Math.PI / n) * i - Math.PI / 2;
    coords.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return coords.join(' ');
}
