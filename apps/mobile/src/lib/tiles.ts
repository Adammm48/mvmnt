/**
 * Web Mercator, enough of it to put real streets under a route.
 *
 * The first version of the route view drew the polyline alone on a dark card.
 * It was honest about distance and shape and it told a member nothing they
 * could act on — an orange loop floating in space does not answer "where do we
 * actually run", which is the only question the screen exists for.
 *
 * This is the projection every slippy map uses, so a route drawn on Leaflet in
 * the organiser's console and the same route drawn here land on the same
 * streets. No map SDK, no API key, no native module: tiles are images, and the
 * app already renders images and SVG.
 */

const TILE = 256;

export type LngLat = [number, number];

export type TilePlan = {
  zoom: number;
  /** Tiles to fetch, with where each one sits in the view. */
  tiles: { x: number; y: number; left: number; top: number }[];
  /** Project a coordinate into view pixels — the polyline uses this. */
  project: (point: LngLat) => [number, number];
};

/** Longitude → world pixel x at a zoom. */
function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** zoom;
}

/** Latitude → world pixel y at a zoom (Mercator, clamped to the valid band). */
function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  const merc = Math.asinh(Math.tan(rad));
  return (0.5 - merc / (2 * Math.PI)) * TILE * 2 ** zoom;
}

/**
 * Work out which tiles to fetch and how to place a route on top of them.
 *
 * Picks the closest zoom that still fits the whole route in the view, so a 6K
 * loop fills the card and a 200m dogleg does not render as a dot on a map of
 * the governorate.
 */
export function planTiles(
  route: LngLat[],
  width: number,
  height: number,
  { padding = 24, maxZoom = 17, minZoom = 3 } = {},
): TilePlan | null {
  if (!route || route.length < 2 || width <= 0 || height <= 0) return null;

  const lngs = route.map(([lo]) => lo);
  const lats = route.map(([, la]) => la);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const usableW = Math.max(width - padding * 2, 1);
  const usableH = Math.max(height - padding * 2, 1);

  // Largest zoom at which the route's bounding box still fits. Descending, so
  // the first fit is the tightest one.
  let zoom = minZoom;
  for (let z = maxZoom; z >= minZoom; z--) {
    const spanX = Math.abs(lngToWorldX(maxLng, z) - lngToWorldX(minLng, z));
    // y is inverted in Mercator: max latitude is the smaller pixel value.
    const spanY = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
    if (spanX <= usableW && spanY <= usableH) {
      zoom = z;
      break;
    }
  }

  // Centre the route in the view, in world pixels.
  const centreX = (lngToWorldX(minLng, zoom) + lngToWorldX(maxLng, zoom)) / 2;
  const centreY = (latToWorldY(minLat, zoom) + latToWorldY(maxLat, zoom)) / 2;
  const originX = centreX - width / 2;
  const originY = centreY - height / 2;

  const project = ([lo, la]: LngLat): [number, number] => [
    lngToWorldX(lo, zoom) - originX,
    latToWorldY(la, zoom) - originY,
  ];

  // Every tile the view touches. floor() of the origin gives the first tile
  // column/row; the loop runs until the view is covered.
  const maxTile = 2 ** zoom - 1;
  const firstX = Math.floor(originX / TILE);
  const firstY = Math.floor(originY / TILE);
  const lastX = Math.floor((originX + width) / TILE);
  const lastY = Math.floor((originY + height) / TILE);

  const tiles: TilePlan['tiles'] = [];
  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      // Off the top or bottom of the world: no tile exists, and requesting one
      // returns an error image. Longitude wraps, latitude does not.
      if (y < 0 || y > maxTile) continue;
      const wrappedX = ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
      tiles.push({
        x: wrappedX,
        y,
        left: x * TILE - originX,
        top: y * TILE - originY,
      });
    }
  }

  return { zoom, tiles, project };
}

/**
 * Where the tiles come from.
 *
 * OpenStreetMap's own tiles, as used by the organiser's console — no key, no
 * account, and the same rendering on every platform. Their tile usage policy
 * is written for heavy and bulk consumers; a club of a few hundred people
 * looking at one route each is comfortably inside it, and this is the single
 * place to change if that ever stops being true.
 */
export function tileUrl(x: number, y: number, zoom: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/** Straight-line length between points — a sanity figure, not a survey. */
export function routeKm(route: LngLat[]): number {
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
