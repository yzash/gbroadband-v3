"use client";

import { useEffect, useState } from "react";

/** Static network geometry served by /api/geo (recorded topology). */
export interface GeoPayload {
  elements: {
    id: string;
    kind: "olt" | "pon" | "splitter" | "nap";
    parent: string | null;
    lat: number;
    lon: number;
    est: boolean; // location estimated (plant record has no coordinates)
    city: string | null;
    district: string | null;
    label: string;
    tier: number | null;
    conf: number;
  }[];
  lines: {
    id: string;
    lat: number;
    lon: number;
    est: boolean;
    nap: string | null; // recorded parent
    city: string | null;
    district: string | null;
    polled: boolean;
    conf: number;
    arpu: number;
    vip: boolean;
    b2b: boolean;
  }[];
  districts: { id: string; name: string; city: string; lat: number; lon: number }[];
}

export interface CityFeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: string; name: string }; geometry: GeoJSON.Geometry }[];
}

export interface GeoBundle {
  geo: GeoPayload;
  cities: CityFeatureCollection;
  /** element id -> recorded children ids (elements and lines). */
  children: Map<string, string[]>;
  elementById: Map<string, GeoPayload["elements"][number]>;
  lineById: Map<string, GeoPayload["lines"][number]>;
  /** city name -> label anchor [lon, lat] (mean of its districts; polygon centroid otherwise). */
  cityLabels: Map<string, [number, number]>;
  /** city name -> [w, s, e, n] */
  cityBounds: Map<string, [number, number, number, number]>;
}

let citiesCache: Promise<CityFeatureCollection> | null = null;

/**
 * Loads geometry once per sensing configuration (polling flags change when the
 * director degrades coverage). City boundaries are fetched once and cached.
 */
export function useGeo(coverageKey: number | undefined): GeoBundle | null {
  const [bundle, setBundle] = useState<GeoBundle | null>(null);

  useEffect(() => {
    let alive = true;
    citiesCache ??= fetch("/geo/ncr-cities.geojson").then((r) => r.json());
    Promise.all([fetch("/api/geo", { cache: "no-store" }).then((r) => r.json() as Promise<GeoPayload>), citiesCache])
      .then(([geo, cities]) => {
        if (alive) setBundle(buildBundle(geo, cities));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [coverageKey]);

  return bundle;
}

function buildBundle(geo: GeoPayload, cities: CityFeatureCollection): GeoBundle {
  const children = new Map<string, string[]>();
  const add = (p: string | null, c: string) => {
    if (!p) return;
    const arr = children.get(p);
    if (arr) arr.push(c);
    else children.set(p, [c]);
  };
  for (const e of geo.elements) add(e.parent, e.id);
  for (const l of geo.lines) add(l.nap, l.id);

  const cityBounds = new Map<string, [number, number, number, number]>();
  const cityCentroid = new Map<string, [number, number]>();
  for (const f of cities.features) {
    let [w, s, e, n] = [180, 90, -180, -90];
    let sx = 0,
      sy = 0,
      k = 0;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    for (const poly of polys as number[][][][]) {
      for (const [x, y] of poly[0]) {
        w = Math.min(w, x);
        s = Math.min(s, y);
        e = Math.max(e, x);
        n = Math.max(n, y);
        sx += x;
        sy += y;
        k++;
      }
    }
    cityBounds.set(f.properties.name, [w, s, e, n]);
    cityCentroid.set(f.properties.name, [sx / Math.max(1, k), sy / Math.max(1, k)]);
  }

  const cityLabels = new Map<string, [number, number]>();
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const d of geo.districts) {
    const a = acc.get(d.city) ?? { x: 0, y: 0, n: 0 };
    a.x += d.lon;
    a.y += d.lat;
    a.n++;
    acc.set(d.city, a);
  }
  for (const f of cities.features) {
    const a = acc.get(f.properties.name);
    cityLabels.set(f.properties.name, a ? [a.x / a.n, a.y / a.n] : cityCentroid.get(f.properties.name)!);
  }

  return {
    geo,
    cities,
    children,
    elementById: new Map(geo.elements.map((e) => [e.id, e])),
    lineById: new Map(geo.lines.map((l) => [l.id, l])),
    cityLabels,
    cityBounds,
  };
}

/** All recorded lines at or under an element (or the line itself). */
export function linesUnder(b: GeoBundle, id: string): string[] {
  if (b.lineById.has(id)) return [id];
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of b.children.get(cur) ?? []) {
      if (b.lineById.has(c)) out.push(c);
      else stack.push(c);
    }
  }
  return out;
}

/** Location of any element or line. */
export function locate(b: GeoBundle, id: string | null | undefined): [number, number] | null {
  if (!id) return null;
  const e = b.elementById.get(id) ?? b.lineById.get(id);
  return e ? [e.lon, e.lat] : null;
}
