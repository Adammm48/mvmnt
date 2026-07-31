import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { meetingPointMapsUrl } from '@mvmnt/shared';

type Props = {
  lat: number;
  lng: number;
  radiusM: number;
  onChange: (lat: number, lng: number) => void;
};

/**
 * Pick the meeting point on a map.
 *
 * Replaces two raw latitude/longitude boxes, which asked a non-technical
 * organiser to type coordinates and gave them no way to tell whether the
 * numbers were right. Getting them wrong is not cosmetic: the check-in geofence
 * is measured from this point, so a bad value means members standing at the
 * real meeting spot cannot check in.
 *
 * The shaded circle is the actual check-in radius, so the organiser can see the
 * zone rather than imagining it.
 *
 * OpenStreetMap tiles via Leaflet: no API key, no billing account, no vendor
 * signup. App Spec §12 names Mapbox or Google for Phase 4 route *drawing* —
 * that is a heavier job and can bring its own key when it arrives. Dropping one
 * pin does not justify an account today (Principles §1).
 */
export function MeetingPointPicker({ lat, lng, radiusM, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Keep the latest callback without re-running the map setup effect, which
  // would tear down and rebuild the map on every keystroke elsewhere.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { attributionControl: true }).setView(
      [lat, lng],
      15,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    const circle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#16191F',
      fillColor: '#16191F',
      fillOpacity: 0.12,
      weight: 2,
    }).addTo(map);

    const move = (next: L.LatLng) => {
      marker.setLatLng(next);
      circle.setLatLng(next);
      onChangeRef.current(Number(next.lat.toFixed(6)), Number(next.lng.toFixed(6)));
    };

    marker.on('dragend', () => move(marker.getLatLng()));
    map.on('click', (e: L.LeafletMouseEvent) => move(e.latlng));

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // Leaflet measures the container on creation; inside a form that is still
    // laying out, that measurement is wrong and the tiles render as grey
    // fragments until something forces a recalculation.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external edits (loading an existing run) without fighting a drag.
  useEffect(() => {
    const marker = markerRef.current;
    const circle = circleRef.current;
    const map = mapRef.current;
    if (!marker || !circle || !map) return;

    const current = marker.getLatLng();
    if (Math.abs(current.lat - lat) > 1e-6 || Math.abs(current.lng - lng) > 1e-6) {
      marker.setLatLng([lat, lng]);
      circle.setLatLng([lat, lng]);
      map.setView([lat, lng], map.getZoom());
    }
  }, [lat, lng]);

  useEffect(() => {
    circleRef.current?.setRadius(radiusM);
  }, [radiusM]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNote('This browser cannot find your location.');
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        onChangeRef.current(Number(latitude.toFixed(6)), Number(longitude.toFixed(6)));
        mapRef.current?.setView([latitude, longitude], 16);
      },
      () => {
        setLocating(false);
        setNote('Could not get your location. Drag the pin instead.');
      },
    );
  }

  return (
    <div className="field">
      <label>Where do you meet?</label>
      <div className="hint" style={{ marginBottom: 8 }}>
        Drag the pin to the exact spot you gather. The shaded circle is how close
        someone has to be for the app to check them in — if the pin is wrong,
        people standing right there won't be able to.
      </div>

      <div ref={containerRef} className="map" />

      <div className="inline" style={{ marginTop: 8 }}>
        <button type="button" onClick={useMyLocation} disabled={locating}>
          {locating ? 'Finding you…' : '📍 I’m standing there now'}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        {/*
          The same link members tap on their run screen, from the same
          coordinates — so "check the pin" and "what members will see" are one
          action rather than two things that can drift apart.
        */}
        <a
          href={meetingPointMapsUrl({ meeting_point_lat: lat, meeting_point_lng: lng })}
          target="_blank"
          rel="noreferrer"
          className="hint"
          style={{ margin: 0 }}
        >
          Open in Google Maps ↗
        </a>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        That link is what members get as “Get directions” — worth opening once
        before you publish.
      </div>
      {note && <div className="hint">{note}</div>}
    </div>
  );
}
