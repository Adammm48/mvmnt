import { useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { colors, radius as radii, spacing, typography } from '@mvmnt/shared';
import { planTiles, routeKm, tileUrl, type LngLat } from '@/lib/tiles';

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
 * The run's route, on a real map.
 *
 * The first version of this drew the polyline alone on a dark card — no
 * streets, no landmarks, just a shape. It was accurate about distance and told
 * a member nothing they could use: "where do we actually run" is the entire
 * question the screen exists to answer, and an orange loop floating in space
 * does not answer it. The owner's verdict on that version was that it
 * "represents nothing", which was correct.
 *
 * Now it renders OpenStreetMap tiles with the route drawn over them, using the
 * same Web Mercator projection the organiser's console draws on — so the line a
 * member sees sits on the same streets the organiser clicked. Still no map SDK,
 * no API key and no native module: tiles are images, and the projection is
 * fifty lines of arithmetic in `lib/tiles.ts`.
 */
export function RouteMap({
  route,
  distanceMeters,
  height = 240,
  live = [],
}: {
  route: LngLat[];
  distanceMeters?: number | null;
  height?: number;
  /** Friends sharing live location, drawn on the same map. */
  live?: LiveDot[];
}) {
  // The tile grid depends on the view's real width, which is only known after
  // layout — so the map is planned on measure rather than guessed from
  // Dimensions, which would be wrong inside any padded container.
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (!route || route.length < 2) return null;

  const km = distanceMeters ? distanceMeters / 1000 : routeKm(route);
  // Within ~40m of where it began: a loop, not an out-and-back.
  const loops = routeKm([route[0]!, route[route.length - 1]!]) < 0.04;
  const plan = width > 0 ? planTiles(route, width, height) : null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.canvas, { height }]} onLayout={onLayout}>
        {plan && (
          <>
            {plan.tiles.map((t) => (
              <Image
                key={`${plan.zoom}/${t.x}/${t.y}`}
                source={{ uri: tileUrl(t.x, t.y, plan.zoom) }}
                style={[styles.tile, { left: t.left, top: t.top }]}
                // Tiles butt against each other; any resizing gives seams.
                resizeMode="cover"
              />
            ))}

            <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
              {/* A white casing under the line, so the route stays legible over
                  dark parks and pale motorways alike. */}
              <Path
                d={toPath(route, plan.project)}
                stroke="#FFFFFF"
                strokeWidth={7}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
              <Path
                d={toPath(route, plan.project)}
                stroke={colors.action}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {(() => {
                const start = plan.project(route[0]!);
                const end = plan.project(route[route.length - 1]!);
                // Most club routes are loops, and on a loop the finish marker
                // lands on the start and hides it — so the legend promised a
                // green dot that was nowhere on the map. One marker says what
                // is true: this is where you start and where you come back to.
                // Ink markers, not base-coloured ones: the base is white now,
                // and a white dot with a white stroke vanishes into the map.
                if (loops) {
                  return (
                    <>
                      <Circle cx={start[0]} cy={start[1]} r={9} fill={colors.action} stroke="#FFFFFF" strokeWidth={2.5} />
                      <Circle cx={start[0]} cy={start[1]} r={4.5} fill={colors.success} />
                    </>
                  );
                }
                return (
                  <>
                    <Circle cx={start[0]} cy={start[1]} r={7} fill={colors.success} stroke="#FFFFFF" strokeWidth={2.5} />
                    <Circle cx={end[0]} cy={end[1]} r={7} fill={colors.action} stroke="#FFFFFF" strokeWidth={2.5} />
                  </>
                );
              })()}

              {/* Friends out on the course. A stale dot dims rather than
                  vanishing: "roughly there a minute ago" is more honest than
                  either certainty or absence. */}
              {live.map((dot) => {
                const [x, y] = plan.project([dot.lng, dot.lat]);
                return (
                  <G key={dot.id} opacity={dot.stale ? 0.45 : 1}>
                    <Circle cx={x} cy={y} r={8} fill={colors.highlight} stroke="#FFFFFF" strokeWidth={2.5} />
                    {/* Halo then fill: react-native-svg has no paint-order, so
                        the outline is drawn as a separate text underneath. */}
                    <SvgText
                      x={x}
                      y={y - 13}
                      fontSize={12}
                      fontWeight="700"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={4}
                      textAnchor="middle"
                    >
                      {dot.label}
                    </SvgText>
                    <SvgText
                      x={x}
                      y={y - 13}
                      fontSize={12}
                      fontWeight="700"
                      fill={colors.action}
                      textAnchor="middle"
                    >
                      {dot.label}
                    </SvgText>
                  </G>
                );
              })}
            </Svg>
          </>
        )}

        {/* OpenStreetMap's licence requires visible attribution. */}
        <Text style={styles.attribution}>© OpenStreetMap</Text>
      </View>

      <View style={styles.legend}>
        {loops ? (
          <Legend colour={colors.success} label="Start and finish" />
        ) : (
          <>
            <Legend colour={colors.success} label="Start" />
            <Legend colour={colors.action} label="Finish" />
          </>
        )}
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

function toPath(route: LngLat[], project: (p: LngLat) => [number, number]): string {
  return route
    .map((point, i) => {
      const [x, y] = project(point);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  canvas: {
    backgroundColor: colors.baseElevated,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  tile: { position: 'absolute', width: 256, height: 256 },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 10,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: colors.textOnDarkMuted },
  legendText: { fontSize: 13, color: colors.textOnDarkMuted },
  distance: { ...typography.data, fontSize: 14, color: colors.textOnDark, marginLeft: 'auto' },
});
