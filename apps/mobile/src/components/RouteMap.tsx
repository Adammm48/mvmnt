import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { colors, radius as radii, spacing, typography } from '@mvmnt/shared';

type LngLat = [number, number];

/** A friend out on the course right now (ADR 0004). */
export type LiveDot = {
  id: string;
  /** First name or initials — drawn beside the dot. */
  label: string;
  lat: number;
  lng: number;
  /** True when the position is old enough to distrust; drawn dimmed. */
  stale: boolean;
};

/**
 * The route, drawn as a shape rather than on a map.
 *
 * App Spec §12 names react-native-maps for the mobile side, and this
 * deliberately does not use it — yet.
 *
 * What a member needs before a run is the shape and the length: does it loop
 * back, is it an out-and-back, how far. A tiled map answers "which street is
 * that" — genuinely useful *during* a run, which is Phase 4's live-tracking
 * half and not built. Drawing the polyline with react-native-svg, already a
 * dependency for the friend QR and the tier badges, answers today's question
 * with no native module, no API key and no per-platform rendering difference to
 * QA (Principles §1, App Spec §12's note that maps look different per platform).
 *
 * When live tracking arrives, a real map does too — and this component's job
 * moves to being the static preview inside it.
 */
export function RouteMap({
  route,
  distanceMeters,
  height = 200,
  live = [],
}: {
  route: LngLat[];
  distanceMeters?: number | null;
  height?: number;
  /** Friends sharing live location, projected onto the same shape. */
  live?: LiveDot[];
}) {
  if (!route || route.length < 2) return null;

  const path = toPath(route);
  const km = distanceMeters ? distanceMeters / 1000 : approximateKm(route);

  return (
    <View style={styles.wrap}>
      <View style={[styles.canvas, { height }]}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          {/* A wider dark stroke under the line, so the route reads against the
              card whichever way it happens to bend. */}
          <Path d={path.d} stroke={colors.base} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path
            d={path.d}
            stroke={colors.action}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={path.start[0]} cy={path.start[1]} r={3.5} fill={colors.success} stroke={colors.base} strokeWidth={1.5} />
          <Circle cx={path.end[0]} cy={path.end[1]} r={3.5} fill={colors.textOnDark} stroke={colors.base} strokeWidth={1.5} />

          {/* Friends out on the course, through the same projection as the
              line itself — a dot two-thirds around the loop reads as exactly
              that. A stale dot dims rather than vanishing: "roughly there a
              minute ago" is more honest than either certainty or absence. */}
          {live.map((dot) => {
            const [x, y] = path.project([dot.lng, dot.lat]);
            return (
              <G key={dot.id} opacity={dot.stale ? 0.45 : 1}>
                <Circle cx={x} cy={y} r={4.5} fill={colors.highlight} stroke={colors.base} strokeWidth={1.5} />
                <SvgText
                  x={x}
                  y={y - 7}
                  fontSize={7}
                  fontWeight="700"
                  fill={colors.textOnDark}
                  stroke={colors.base}
                  strokeWidth={0.4}
                  textAnchor="middle"
                >
                  {dot.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      <View style={styles.legend}>
        <Legend colour={colors.success} label="Start" />
        <Legend colour={colors.textOnDark} label="Finish" />
        <Text style={styles.distance}>{km.toFixed(1)}K</Text>
      </View>
    </View>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: colour }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/**
 * Fit the route into a 100×100 box.
 *
 * Latitude is scaled by cos(lat) so the shape is not stretched — a degree of
 * longitude in Cairo is about 88km against 111km for latitude, and ignoring
 * that draws every east-west route noticeably squashed.
 */
function toPath(route: LngLat[]): {
  d: string;
  start: [number, number];
  end: [number, number];
  /** Project any [lng, lat] with the same fit as the route — for live dots. */
  project: (point: LngLat) => [number, number];
} {
  const midLat = route.reduce((sum, [, la]) => sum + la, 0) / route.length;
  const scale = Math.cos((midLat * Math.PI) / 180);

  const xs = route.map(([lo]) => lo * scale);
  const ys = route.map(([, la]) => la);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // A route can be nearly a straight line, which makes one span ~0 and the
  // division explode. Falling back to the other span keeps the aspect honest.
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const span = Math.max(spanX, spanY) || 1e-6;

  const pad = 8;
  const usable = 100 - pad * 2;
  // Centre the smaller axis rather than stretching it.
  const offsetX = (usable - (spanX / span) * usable) / 2;
  const offsetY = (usable - (spanY / span) * usable) / 2;

  const points = route.map(([lo, la]) => {
    const x = pad + offsetX + ((lo * scale - minX) / span) * usable;
    // SVG y grows downward; latitude grows northward. Flipping here is what
    // stops every route rendering upside down.
    const y = pad + offsetY + (usable - ((la - minY) / span) * usable);
    return [x, y] as [number, number];
  });

  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');

  const project = ([lo, la]: LngLat): [number, number] => [
    pad + offsetX + ((lo * scale - minX) / span) * usable,
    pad + offsetY + (usable - ((la - minY) / span) * usable),
  ];

  return { d, start: points[0]!, end: points[points.length - 1]!, project };
}

/** Straight-line length between clicked points — a sanity figure, not a survey. */
function approximateKm(route: LngLat[]): number {
  let metres = 0;
  for (let i = 1; i < route.length; i++) {
    const [lo1, la1] = route[i - 1]!;
    const [lo2, la2] = route[i]!;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(la2 - la1);
    const dLng = toRad(lo2 - lo1);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
    metres += 6_371_000 * 2 * Math.asin(Math.sqrt(h));
  }
  return metres / 1000;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  canvas: {
    backgroundColor: colors.baseElevated,
    borderRadius: radii.lg,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 13, color: colors.textOnDarkMuted },
  distance: { ...typography.data, fontSize: 14, color: colors.textOnDark, marginLeft: 'auto' },
});
