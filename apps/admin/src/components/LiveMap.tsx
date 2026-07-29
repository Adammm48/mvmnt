import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';

type LngLat = [number, number];

type Sharer = {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
  updated_at: string;
};

/**
 * Who is still out on the course — the organiser's half of ADR 0004.
 *
 * A real tiled map here, unlike the member app's SVG shape: the organiser's
 * question is "where exactly is the person whose dot has not moved", and
 * "which street" is the entire answer. Leaflet is already a dependency for
 * the meeting-point picker and the route drawer.
 *
 * Only members who switched sharing on appear. That boundary is enforced by
 * the database (a row only exists while its member shares), so this screen
 * could not show a non-sharer if it tried — there is nothing to read.
 */
export function LiveMap({
  runId,
  meetingPoint,
  route,
}: {
  runId: string;
  meetingPoint: { lat: number; lng: number };
  route: LngLat[] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const [sharers, setSharers] = useState<Sharer[]>([]);

  // The map, once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([meetingPoint.lat, meetingPoint.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    L.marker([meetingPoint.lat, meetingPoint.lng]).addTo(map).bindTooltip('Meeting point');

    if (route && route.length >= 2) {
      const latLngs = route.map(([lo, la]) => [la, lo] as [number, number]);
      L.polyline(latLngs, { color: '#16191F', weight: 4, opacity: 0.7 }).addTo(map);
      map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30] });
    }

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sharers, every ten seconds — same cadence as the phones sending.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const { data } = await supabase
        .from('live_positions')
        .select('user_id, lat, lng, updated_at, profiles(display_name)')
        .eq('run_id', runId);
      if (cancelled || !data) return;

      setSharers(
        data.map((row) => {
          const profile = row.profiles as unknown as { display_name: string } | null;
          return {
            user_id: row.user_id,
            display_name: profile?.display_name ?? 'A member',
            lat: row.lat,
            lng: row.lng,
            updated_at: row.updated_at,
          };
        }),
      );
    }

    void poll();
    const timer = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  // Markers move rather than being recreated, so the map does not flicker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const s of sharers) {
      seen.add(s.user_id);
      const existing = markersRef.current.get(s.user_id);
      const age = Math.round((Date.now() - new Date(s.updated_at).getTime()) / 1000);
      const label = `${s.display_name} · ${age < 15 ? 'now' : `${age}s ago`}`;
      if (existing) {
        existing.setLatLng([s.lat, s.lng]);
        existing.setTooltipContent(label);
        existing.setOpacity(age > 30 ? 0.5 : 1);
      } else {
        const marker = L.marker([s.lat, s.lng])
          .addTo(map)
          .bindTooltip(label, { permanent: true, direction: 'top', offset: [-14, -10] });
        markersRef.current.set(s.user_id, marker);
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [sharers]);

  return (
    <div className="card">
      <h3 className="section-title">Out on the course</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {sharers.length === 0
          ? 'Nobody is sharing live location right now. Members switch it on themselves, per run — you cannot switch it on for them.'
          : `${sharers.length} member${sharers.length === 1 ? '' : 's'} sharing. A faded pin has been quiet for a while — worth a look if it stays put. Dots disappear two minutes after a phone goes silent, and the moment the run ends.`}
      </p>
      <div className="map" ref={containerRef} style={{ height: 360 }} />
    </div>
  );
}
