"use client";

import { useEffect, useRef } from "react";

export interface MapPin {
  id: string;
  lng: number;
  lat: number;
  /** "origin" = navy depot pin, "stop" = numbered red/grey, "truck" = vehicle */
  kind: "origin" | "stop" | "truck";
  label?: string;
  /** For stops: 1-indexed number badge. For trucks: vehicle reg. */
  badge?: string;
  /** done/current/pending — affects fill colour for stops */
  state?: "done" | "current" | "pending";
  /** halo around selected truck */
  selected?: boolean;
  /** colour override (e.g. amber for delayed) */
  color?: string;
  onClick?: () => void;
}

export interface MapRoute {
  id: string;
  /** [[lng,lat], ...] in order */
  points: Array<[number, number]>;
  /** done = solid green, remaining = dashed blue, alt = dashed grey */
  state: "done" | "remaining" | "alt";
}

interface PortalMapProps {
  pins: MapPin[];
  routes?: MapRoute[];
  /** auto-fit bounds to pins on first render and whenever pins change */
  autoFit?: boolean;
  /** fallback centre if no pins */
  defaultCenter?: [number, number];
  defaultZoom?: number;
  /** map height — required so Mapbox initialises correctly */
  height?: number | string;
  className?: string;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const STYLE = "mapbox://styles/mapbox/light-v11";
const UK_CENTER: [number, number] = [-2.5, 53.5];

export default function PortalMap({
  pins,
  routes = [],
  autoFit = true,
  defaultCenter = UK_CENTER,
  defaultZoom = 5.3,
  height = "100%",
  className,
}: PortalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // We type these as `unknown` here and cast at use-sites because the
  // mapbox-gl types pull in DOM types we don't want to widen this whole
  // file with. The dynamic import keeps mapbox-gl out of the SSR bundle.
  const mapRef = useRef<unknown>(null);
  const mapboxRef = useRef<unknown>(null);
  const markersRef = useRef<Array<{ remove: () => void }>>([]);
  const sourcesAddedRef = useRef<Set<string>>(new Set());

  // Init map once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!containerRef.current || mapRef.current) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      mapboxRef.current = mapboxgl;
      mapboxgl.accessToken = TOKEN || "no-token";
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: STYLE,
        center: defaultCenter,
        zoom: defaultZoom,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      const map = mapRef.current as { remove?: () => void } | null;
      map?.remove?.();
      mapRef.current = null;
    };
    // defaultCenter/defaultZoom are first-render only — re-mount the component
    // if you need to relocate the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers + routes whenever inputs change
  useEffect(() => {
    const map = mapRef.current as
      | { isStyleLoaded: () => boolean; on: (e: string, cb: () => void) => void }
      | null;
    const mapboxgl = mapboxRef.current as
      | { Marker: new (opts: { element: HTMLElement }) => { setLngLat: (ll: [number, number]) => unknown } }
      | null;
    if (!map || !mapboxgl) return;

    const apply = () => renderOverlay(map, mapboxgl, pins, routes, markersRef, sourcesAddedRef, autoFit);

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.on("load", apply);
    }
  }, [pins, routes, autoFit]);

  if (!TOKEN) {
    return (
      <div
        className={className}
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-500)",
          fontSize: 12.5,
          background: "var(--surface-alt)",
          border: "1px dashed var(--line-strong)",
          borderRadius: 6,
        }}
      >
        Map unavailable — set NEXT_PUBLIC_MAPBOX_TOKEN to enable.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height }}
    />
  );
}

// Casting via `any` is contained to this single render function. Mapbox's
// runtime API is large and dynamic; the wider portal stays strict.
/* eslint-disable @typescript-eslint/no-explicit-any */
function renderOverlay(
  map: any,
  mapboxgl: any,
  pins: MapPin[],
  routes: MapRoute[],
  markersRef: React.RefObject<Array<{ remove: () => void }>>,
  sourcesAddedRef: React.RefObject<Set<string>>,
  autoFit: boolean,
) {
  // Clear old markers
  for (const mk of markersRef.current ?? []) mk.remove();
  if (markersRef.current) markersRef.current.length = 0;

  // Add/replace route lines
  const ROUTE_PREFIX = "portal-route-";
  const sourcesNow = sourcesAddedRef.current ?? new Set<string>();
  // Remove stale layers/sources
  for (const sid of Array.from(sourcesNow)) {
    if (!routes.find((r) => `${ROUTE_PREFIX}${r.id}` === sid)) {
      try {
        if (map.getLayer(`${sid}-line`)) map.removeLayer(`${sid}-line`);
        if (map.getSource(sid)) map.removeSource(sid);
        sourcesNow.delete(sid);
      } catch {
        // ignore
      }
    }
  }
  for (const r of routes) {
    const id = `${ROUTE_PREFIX}${r.id}`;
    const geojson = {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: r.points,
      },
      properties: {},
    };
    if (sourcesNow.has(id)) {
      const src = map.getSource(id);
      src?.setData(geojson);
    } else {
      map.addSource(id, { type: "geojson", data: geojson });
      map.addLayer({
        id: `${id}-line`,
        type: "line",
        source: id,
        paint: {
          "line-color":
            r.state === "done"
              ? "#117C4B"
              : r.state === "alt"
                ? "#A6ACBC"
                : "#1B3F90",
          "line-width": 3,
          "line-dasharray": r.state === "done" ? [1] : [2, 1.5],
          "line-opacity": r.state === "alt" ? 0.5 : 0.9,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      sourcesNow.add(id);
    }
  }

  // Add new markers
  for (const pin of pins) {
    const el = buildPinElement(pin);
    if (pin.onClick) {
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        pin.onClick?.();
      });
    }
    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([pin.lng, pin.lat])
      .addTo(map);
    if (pin.label) {
      el.title = pin.label;
    }
    markersRef.current?.push(marker as { remove: () => void });
  }

  // Auto-fit
  if (autoFit && pins.length > 0) {
    const bounds = new mapboxgl.LngLatBounds();
    pins.forEach((p) => bounds.extend([p.lng, p.lat]));
    routes.forEach((r) => r.points.forEach((pt) => bounds.extend(pt)));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 11,
        duration: 600,
      });
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildPinElement(pin: MapPin): HTMLDivElement {
  const el = document.createElement("div");
  el.style.transform = "translate(-50%, -50%)";
  el.style.borderRadius = "999px";
  el.style.border = "2px solid #fff";
  el.style.boxShadow = "0 1px 4px rgba(14,19,32,0.25)";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.color = "#fff";
  el.style.fontWeight = "600";
  el.style.fontSize = "11px";
  el.style.fontFamily = "var(--font-portal-mono)";

  if (pin.kind === "origin") {
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.background = "#0B2A6B";
  } else if (pin.kind === "truck") {
    const sz = pin.selected ? 28 : 22;
    el.style.width = `${sz}px`;
    el.style.height = `${sz}px`;
    el.style.background = pin.color ?? "#D81E2A";
    if (pin.selected) el.style.boxShadow = "0 0 0 6px rgba(216,30,42,0.18)";
    el.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17V6a1 1 0 0 1 1-1h10v12H3zM14 9h4l3 4v4h-7V9z"/></svg>';
  } else {
    // stop
    const sz = 22;
    el.style.width = `${sz}px`;
    el.style.height = `${sz}px`;
    el.style.background =
      pin.state === "done"
        ? "#117C4B"
        : pin.state === "current"
          ? "#D81E2A"
          : "#5C6478";
    if (pin.badge) el.textContent = pin.badge;
  }

  return el;
}
