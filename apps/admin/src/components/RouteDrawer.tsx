import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LngLat = [number, number];

type Props = {
  /** The meeting point, drawn as the anchor the route should start from. */
  lat: number;
  lng: number;
  route: LngLat[];
  onChange: (route: LngLat[]) => void;
};

/**
 * Draw the run's route by clicking along it.
 *
 * App Spec §4.7 asks for the organiser to draw the route in-app rather than
 * importing a GPX, and §12 suggests Mapbox or Google for this. Neither is used:
 * Leaflet with OpenStreetMap tiles already draws the meeting-point picker, it
 * needs no API key or billing account, and clicking a polyline is not the part
 * of route drawing those services are better at. Adding a keyed map provider
 * for this would be a dependency and an account for something already working
 * (Principles §1).
 *
 * COORDINATE ORDER
 *
 * Stored as [lng, lat] to match GeoJSON, so the data is already right if the
 * column ever becomes a geometry. Leaflet uses [lat, lng]. The two are
 * converted at exactly the two points below and nowhere else — a transposition
 * that leaks past here renders the route somewhere off the Horn of Africa, and
 * the server rejects latitudes beyond ±90 as a last line of defence.
 */
export function RouteDrawer({ lat, lng, route, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  // Held in a ref as well as props so the click handler — bound once — always
  // reads the current route rather than the one captured at mount.
  const routeRef = useRef<LngLat[]>(route);
  const [hint, setHint] = useState<string | null>(null);

  routeRef.current = route;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // The meeting point, so the organiser draws from somewhere real.
    L.marker([lat, lng]).addTo(map).bindTooltip('Meeting point');

    map.on('click', (e: L.LeafletMouseEvent) => {
      onChange([...routeRef.current, [e.latlng.lng, e.latlng.lat]]);
    });

    mapRef.current = map;

    // Leaflet measures the container on creation. Inside a card that is still
    // laying out, that measurement is wrong and half the tiles never load.
    setTimeout(() => {
      map.invalidateSize();

      // Opening a run that already has a route should show the route. Centring
      // on the meeting point is right for a blank one, but a route that starts
      // half a kilometre away renders off the edge, and the organiser's first
      // impression is that their work is gone.
      //
      // Mount only, deliberately: refitting on every change would pan the map
      // out from under the cursor between clicks, which is a far worse way to
      // draw a line than having to scroll once.
      const existing = routeRef.current;
      if (existing.length >= 2) {
        map.fitBounds(
          L.latLngBounds(existing.map(([lo, la]) => [la, lo] as [number, number])),
          { padding: [30, 30] },
        );
      }
    }, 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount only: re-running this would destroy and rebuild the map on every
    // point added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw whenever the route changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    lineRef.current?.remove();
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (route.length === 0) return;

    const latLngs = route.map(([lo, la]) => [la, lo] as [number, number]);
    lineRef.current = L.polyline(latLngs, { color: '#16191F', weight: 5 }).addTo(map);

    // Only the ends get a handle. A dot on every point turns a hand-drawn route
    // into a wall of circles, and the only two an organiser needs to identify
    // are where it starts and where it finishes.
    const ends = [latLngs[0], latLngs[latLngs.length - 1]].filter(Boolean) as [number, number][];
    ends.forEach((point, i) => {
      const marker = L.circleMarker(point, {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: i === 0 ? '#3DDC84' : '#1B1F2A',
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(i === 0 ? 'Start' : 'Finish');
      markersRef.current.push(marker);
    });
  }, [route]);

  const distanceKm = totalKm(route);

  return (
    <div className="field">
      <label>The route</label>
      <div className="hint">
        Click along the roads you run. Each click adds a point — the line follows them in
        order, so click in the direction of travel.
      </div>

      <div className="map" ref={containerRef} style={{ height: 340, marginTop: 10 }} />

      <div className="inline" style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => {
            if (route.length === 0) {
              setHint('Nothing to undo yet.');
              return;
            }
            setHint(null);
            onChange(route.slice(0, -1));
          }}
        >
          Undo last point
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            onChange([]);
            setHint(null);
          }}
          disabled={route.length === 0}
        >
          Clear
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {route.length === 0
            ? 'No route yet'
            : `${route.length} point${route.length === 1 ? '' : 's'} · about ${distanceKm.toFixed(1)}K`}
        </span>
      </div>

      {hint && <div className="hint">{hint}</div>}

      {route.length === 1 && (
        <div className="hint">One more point and you have a route.</div>
      )}
    </div>
  );
}

/**
 * Rough length, for the organiser's sanity check rather than for the record.
 *
 * Straight lines between clicked points, so it under-reads a route drawn with
 * few points around bends. It is here to catch "I meant 6K and this says 20K",
 * which it does perfectly well — the run's stated distance stays a separate
 * field the organiser sets deliberately.
 */
function totalKm(route: LngLat[]): number {
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
