import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The tab bar's five icons, drawn by hand on react-native-svg.
 *
 * No icon package: the QR code, the tier badges and the route map are already
 * hand-drawn SVG on a dependency the app ships anyway, and five 24px line
 * icons do not justify a new one (Principles §1). A consistent 1.8 stroke and
 * round caps keep them reading as one family.
 */

import type { ColorValue } from 'react-native';

type IconProps = { color: ColorValue; size?: number };
const S = { fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 };

export function HomeIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...S} stroke={color} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1v-9.5Z" />
    </Svg>
  );
}

/** The board: a podium — first, second, third. */
export function BoardIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect {...S} stroke={color} x="9" y="8" width="6" height="12" rx="1" />
      <Rect {...S} stroke={color} x="3" y="12" width="6" height="8" rx="1" />
      <Rect {...S} stroke={color} x="15" y="14" width="6" height="6" rx="1" />
      <Path {...S} stroke={color} d="M12 3.2 12.9 5l2 .3-1.45 1.4.35 2L12 7.75 10.2 8.7l.35-2L9.1 5.3l2-.3.9-1.8Z" />
    </Svg>
  );
}

/** Photos: a camera — which is also the selfie. */
export function PhotosIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...S} stroke={color} d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <Circle {...S} stroke={color} cx="12" cy="13" r="3.4" />
    </Svg>
  );
}

/** The shop: a price tag. */
export function ShopIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...S} stroke={color} d="M12.6 3H19a2 2 0 0 1 2 2v6.4a2 2 0 0 1-.59 1.42l-7.6 7.6a2 2 0 0 1-2.82 0l-6.4-6.4a2 2 0 0 1 0-2.83l7.6-7.6A2 2 0 0 1 12.6 3Z" />
      <Circle cx="16" cy="8" r="1.4" fill={color} />
    </Svg>
  );
}

export function ProfileIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle {...S} stroke={color} cx="12" cy="8" r="3.6" />
      <Path {...S} stroke={color} d="M5 20c.8-3.6 3.7-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Svg>
  );
}
