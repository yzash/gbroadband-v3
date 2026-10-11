"use client";

import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { BRAND } from "@/lib/brand";
import { HEALTH_HEX, pesoCompact } from "@/lib/tokens";
import { NCR_BOUNDS } from "@/lib/geo";
import { type GeoBundle, locate } from "@/lib/geo-client";
import { cityFill, lensAccent, lineStyle, type LayerMode } from "@/lib/map-layers";
import type { OpsSnapshot } from "@/lib/types";
import { FAULT_LABEL } from "@/lib/types";

export type MapSelection = { kind: "incident" | "element" | "line" | "city"; id: string };
export interface MapHover {
  kind: "element" | "line" | "city" | "cluster";
  id: string;
  x: number;
  y: number;
  count?: number;
}
export interface MapFocus {
  observed: string[];
  inferred: string[];
  suspect?: string | null;
}
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  snapshot: OpsSnapshot;
  bundle: GeoBundle;
  layer: LayerMode;
  overlays: { backbone: boolean; incidents: boolean; crews: boolean; heat: boolean };
  selected?: MapSelection | null;
  focus?: MapFocus | null;
  fit?: { key: string; bounds: [number, number, number, number] } | null;
  padding?: Padding;
  compact?: boolean;
  onSelect?: (s: MapSelection | null) => void;
  onHover?: (h: MapHover | null) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_PAD: Padding = { top: 40, right: 40, bottom: 40, left: 40 };
/** Below this zoom the map is an overview: choropleth + heat + incidents only.
 *  Customer-line clusters appear once you zoom into a district. */
const OVERVIEW_MAX = 11.3;

export default function NetworkMapGL(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const loaded = useRef(false);
  const propsRef = useRef(p);
  propsRef.current = p;
  const cityLabels = useRef<maplibregl.Marker[]>([]);
  const clusterMarkers = useRef(new Map<number, maplibregl.Marker>());
  const incidentMarkers = useRef(new Map<string, maplibregl.Marker>());
  const crewMarkers = useRef(new Map<string, maplibregl.Marker>());

  // ---- create once -------------------------------------------------------------
  useEffect(() => {
    const P = propsRef.current;
    const pad = P.padding ?? DEFAULT_PAD;
    const map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#040918" } }],
      },
      bounds: NCR_BOUNDS,
      fitBoundsOptions: { padding: pad },
      maxBounds: [120.7, 14.2, 121.35, 14.95],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      minZoom: 9.4,
      maxZoom: 17.5,
    });
    map.touchZoomRotate.disableRotation();
    // Compact (embedded) maps rely on the app footer for attribution.
    if (!P.compact) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: "Boundaries: PSA PSGC 2023 · synthetic network" }),
        "bottom-right"
      );
    }
    mapRef.current = map;

    map.on("load", () => {
      const B = propsRef.current.bundle;
      // Cities (choropleth). Fill fades as you zoom in so the network leads.
      map.addSource("cities", { type: "geojson", data: B.cities as GeoJSON.FeatureCollection, promoteId: "name" });
      map.addLayer({
        id: "city-fill",
        type: "fill",
        source: "cities",
        paint: {
          "fill-color": ["coalesce", ["feature-state", "c"], "#0B1532"],
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.92, 12, 0.6, 13.5, 0.28, 15.5, 0.12],
        },
      });
      map.addLayer({
        id: "city-line",
        type: "line",
        source: "cities",
        paint: { "line-color": "#2A3D70", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.6] },
      });
      map.addLayer({
        id: "city-hover",
        type: "line",
        source: "cities",
        paint: {
          "line-color": BRAND.globeSky,
          "line-width": 2,
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
        },
      });

      // Outage heat — the shape of trouble at metro scale.
      map.addSource("heat", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "heat",
        type: "heatmap",
        source: "heat",
        maxzoom: 15,
        paint: {
          "heatmap-weight": ["get", "w"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.9, 14, 1.6],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 12, 22, 14, 34],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0.85, 14.8, 0],
        },
      });

      // Backbone (OLT → PON → splitter → NAP) and drops (NAP → line).
      map.addSource("backbone", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "backbone",
        type: "line",
        source: "backbone",
        minzoom: 10.8,
        layout: { "line-cap": "round" },
        paint: {
          "line-color": ["get", "c"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["*", ["get", "w"], 0.6], 15, ["*", ["get", "w"], 1.6]],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.8, 0, 11.6, 0.75],
        },
      });
      map.addSource("drops", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "drops",
        type: "line",
        source: "drops",
        minzoom: 14.6,
        paint: { "line-color": ["get", "c"], "line-width": 0.7, "line-opacity": 0.55 },
      });

      // Crew routes.
      map.addSource("routes", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        paint: { "line-color": BRAND.watch, "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": 0.85 },
      });

      // Lines (ONTs), clustered.
      map.addSource("lines", {
        type: "geojson",
        data: EMPTY,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 38,
        clusterProperties: { att: ["+", ["get", "a"]], crit: ["+", ["get", "crit"]] },
      });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "lines",
        minzoom: OVERVIEW_MAX,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0D1A3F",
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 12, 25, 15, 70, 19, 160, 23],
          "circle-stroke-width": ["case", [">", ["get", "att"], 0], 2.6, 1.2],
          "circle-stroke-color": "#2A3D70",
        },
      });
      map.addLayer({
        id: "line-points",
        type: "circle",
        source: "lines",
        minzoom: OVERVIEW_MAX,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "c"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["*", 2.6, ["get", "r"]], 15, ["*", 4, ["get", "r"]], 17, ["*", 6, ["get", "r"]]],
          "circle-stroke-color": "#040918",
          "circle-stroke-width": 0.6,
        },
      });

      // Network elements.
      map.addSource("elements", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "el-nap",
        type: "circle",
        source: "elements",
        minzoom: 12.4,
        filter: ["==", ["get", "k"], "nap"],
        paint: {
          "circle-color": ["get", "c"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.4, 2.2, 16, 5],
          "circle-stroke-color": "#040918",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "el-mid",
        type: "circle",
        source: "elements",
        minzoom: 11.2,
        filter: ["in", ["get", "k"], ["literal", ["pon", "splitter"]]],
        paint: {
          "circle-color": "#040918",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11.2, 2.6, 16, 6.5],
          "circle-stroke-color": ["get", "c"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "el-olt",
        type: "circle",
        source: "elements",
        filter: ["==", ["get", "k"], "olt"],
        paint: {
          "circle-color": BRAND.globeBlue,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5.5, 15, 10],
          "circle-stroke-color": ["case", ["==", ["get", "dead"], 1], BRAND.critical, BRAND.globeSky],
          "circle-stroke-width": 2.4,
        },
      });

      // Incident focus (blast radius): observed vs silent.
      map.addSource("focus", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "focus-inferred",
        type: "circle",
        source: "focus",
        filter: ["==", ["get", "e"], "inferred"],
        paint: {
          "circle-color": "transparent",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.6, 15, 5.5],
          "circle-stroke-color": BRAND.watch,
          "circle-stroke-width": 1.6,
        },
      });
      map.addLayer({
        id: "focus-observed",
        type: "circle",
        source: "focus",
        filter: ["==", ["get", "e"], "observed"],
        paint: {
          "circle-color": BRAND.critical,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
          "circle-stroke-color": "#040918",
          "circle-stroke-width": 0.8,
        },
      });

      // Selection ring.
      map.addSource("selected", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "selected",
        type: "circle",
        source: "selected",
        paint: {
          "circle-color": "transparent",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 20],
          "circle-stroke-color": BRAND.globeSky,
          "circle-stroke-width": 2.6,
        },
      });

      // City labels as HTML (keeps the app free of an external glyph server).
      for (const [name, at] of B.cityLabels) {
        const d = document.createElement("div");
        d.className = "pointer-events-none select-none text-[10px] font-bold uppercase tracking-[0.14em] text-[#AFBCDB]/70";
        d.style.textShadow = "0 1px 3px #040918";
        d.style.zIndex = "0";
        d.textContent = name;
        cityLabels.current.push(new maplibregl.Marker({ element: d }).setLngLat(at).addTo(map));
      }
      const toggleLabels = () => {
        const z = map.getZoom();
        for (const m of cityLabels.current) m.getElement().style.display = z >= OVERVIEW_MAX || propsRef.current.compact ? "none" : "block";
      };
      map.on("zoom", toggleLabels);
      toggleLabels();

      loaded.current = true;
      applyAll();
      if (propsRef.current.fit) map.fitBounds(propsRef.current.fit.bounds, { padding: propsRef.current.padding ?? DEFAULT_PAD, duration: 0, maxZoom: 15 });
    });

    // ---- interactions ----
    let hoverCity: string | null = null;
    const setCityHover = (id: string | null) => {
      if (hoverCity) map.setFeatureState({ source: "cities", id: hoverCity }, { hover: false });
      hoverCity = id;
      if (id) map.setFeatureState({ source: "cities", id }, { hover: true });
    };
    const pointLayers = ["el-olt", "el-mid", "el-nap", "line-points", "clusters", "focus-observed", "focus-inferred"];

    map.on("mousemove", (e) => {
      const P2 = propsRef.current;
      const f = map.queryRenderedFeatures(e.point, { layers: pointLayers.filter((l) => map.getLayer(l)) })[0];
      if (f) {
        setCityHover(null);
        if (f.layer.id === "clusters") {
          map.getCanvas().style.cursor = "zoom-in";
          P2.onHover?.({ kind: "cluster", id: String(f.properties!.cluster_id), x: e.point.x, y: e.point.y, count: f.properties!.point_count });
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        const isLine = f.layer.id === "line-points" || f.layer.id.startsWith("focus");
        P2.onHover?.({ kind: isLine ? "line" : "element", id: String(f.properties!.id), x: e.point.x, y: e.point.y });
        return;
      }
      const cf = map.queryRenderedFeatures(e.point, { layers: ["city-fill"] })[0];
      if (cf && map.getZoom() < 13.5) {
        map.getCanvas().style.cursor = "pointer";
        setCityHover(String(cf.id));
        P2.onHover?.({ kind: "city", id: String(cf.id), x: e.point.x, y: e.point.y });
        return;
      }
      setCityHover(null);
      map.getCanvas().style.cursor = "";
      P2.onHover?.(null);
    });
    map.on("mouseout", () => {
      setCityHover(null);
      propsRef.current.onHover?.(null);
    });
    map.on("click", (e) => {
      const P2 = propsRef.current;
      const f = map.queryRenderedFeatures(e.point, { layers: pointLayers.filter((l) => map.getLayer(l)) })[0];
      if (f?.layer.id === "clusters") {
        (map.getSource("lines") as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id).then((z) => {
          map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(z + 0.4, 16), duration: 650 });
        });
        return;
      }
      if (f) {
        const isLine = f.layer.id === "line-points" || f.layer.id.startsWith("focus");
        P2.onSelect?.({ kind: isLine ? "line" : "element", id: String(f.properties!.id) });
        return;
      }
      const cf = map.queryRenderedFeatures(e.point, { layers: ["city-fill"] })[0];
      if (cf && map.getZoom() < 13.5 && !P2.compact) {
        const name = String(cf.id);
        const b = P2.bundle.cityBounds.get(name);
        if (b) map.fitBounds(b, { padding: P2.padding ?? DEFAULT_PAD, duration: 800 });
        P2.onSelect?.({ kind: "city", id: name });
        return;
      }
      P2.onSelect?.(null);
    });

    // Cluster count badges (HTML markers, refreshed on render).
    let raf = 0;
    let removed = false;
    const updateClusterLabels = () => {
      raf = 0;
      if (removed || !map.getSource("lines") || !map.isSourceLoaded("lines")) return;
      const seen = new Set<number>();
      const accent = lensAccent(propsRef.current.layer);
      const clustersOn = map.getZoom() >= OVERVIEW_MAX && !propsRef.current.focus;
      for (const f of clustersOn ? map.querySourceFeatures("lines", { filter: ["has", "point_count"] }) : []) {
        const id = f.properties!.cluster_id as number;
        if (seen.has(id)) continue;
        seen.add(id);
        let m = clusterMarkers.current.get(id);
        if (!m) {
          const d = document.createElement("div");
          d.className = "pointer-events-none flex flex-col items-center leading-none";
          m = new maplibregl.Marker({ element: d }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).addTo(map);
          clusterMarkers.current.set(id, m);
        }
        const att = Number(f.properties!.att ?? 0);
        m.getElement().innerHTML =
          `<span style="font:700 10.5px 'Source Sans 3',sans-serif;color:#EEF3FF;font-variant-numeric:tabular-nums">${f.properties!.point_count}</span>` +
          (att > 0
            ? `<span style="margin-top:2px;padding:0 4px;border-radius:6px;background:${accent};color:#040918;font:800 9px 'Source Sans 3',sans-serif">${att}</span>`
            : "");
      }
      for (const [id, m] of clusterMarkers.current) {
        if (!seen.has(id)) {
          m.remove();
          clusterMarkers.current.delete(id);
        }
      }
    };
    map.on("render", () => {
      if (!raf) raf = requestAnimationFrame(updateClusterLabels);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);

    return () => {
      removed = true;
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const m of [...clusterMarkers.current.values(), ...incidentMarkers.current.values(), ...crewMarkers.current.values(), ...cityLabels.current]) m.remove();
      clusterMarkers.current.clear();
      incidentMarkers.current.clear();
      crewMarkers.current.clear();
      cityLabels.current = [];
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- data -----------------------------------------------------------------------
  function applyAll() {
    applyCities();
    applyNetwork();
    applyOverlays();
    applyFocus();
    applySelected();
  }

  function applyCities() {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const { snapshot, layer, bundle } = propsRef.current;
    for (const f of bundle.cities.features) {
      map.setFeatureState({ source: "cities", id: f.properties.name }, { c: cityFill(layer, snapshot.city_stats[f.properties.name]) });
    }
  }

  function applyNetwork() {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const { snapshot, layer, bundle, focus, overlays } = propsRef.current;
    const ctx = { health: snapshot.element_health, ticketed: new Set(snapshot.ticketed_lines) };
    const dim = !!focus;

    const lines: GeoJSON.Feature[] = [];
    const heat: GeoJSON.Feature[] = [];
    const drops: GeoJSON.Feature[] = [];
    for (const l of bundle.geo.lines) {
      const st = lineStyle(layer, l, ctx);
      const g: GeoJSON.Point = { type: "Point", coordinates: [l.lon, l.lat] };
      lines.push({ type: "Feature", properties: { id: l.id, c: dim ? "#1D2C56" : st.c, a: dim ? 0 : st.a, crit: dim ? 0 : st.crit, r: st.r }, geometry: g });
      if (st.a && !dim) heat.push({ type: "Feature", properties: { w: st.crit ? 1 : 0.55 }, geometry: g });
      const nap = l.nap ? bundle.elementById.get(l.nap) : undefined;
      if (nap) drops.push({ type: "Feature", properties: { c: st.a ? st.c : "#24345F" }, geometry: { type: "LineString", coordinates: [[nap.lon, nap.lat], [l.lon, l.lat]] } });
    }
    (map.getSource("lines") as GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
    (map.getSource("heat") as GeoJSONSource).setData({ type: "FeatureCollection", features: overlays.heat ? heat : [] });
    (map.getSource("drops") as GeoJSONSource).setData({ type: "FeatureCollection", features: drops });

    const accent = lensAccent(layer);
    map.setPaintProperty("clusters", "circle-opacity", dim ? 0.35 : 0.92);
    map.setPaintProperty("clusters", "circle-stroke-width", dim ? 0.6 : ["case", [">", ["get", "att"], 0], 2.6, 1.2]);
    map.setPaintProperty("clusters", "circle-stroke-color", ["case", [">", ["get", "crit"], 0], accent, [">", ["get", "att"], 0], hexAlpha(accent, 0.6), "#2A3D70"]);
    map.setPaintProperty("heat", "heatmap-color", [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0,0,0,0)",
      0.15,
      hexAlpha(accent, 0.18),
      0.45,
      hexAlpha(accent, 0.5),
      0.8,
      hexAlpha(accent, 0.8),
      1,
      "#FFE7EA",
    ]);

    // Elements + backbone, coloured by the health of what they feed.
    const deadOlt = snapshot.sensing_health.dead_olt;
    const els: GeoJSON.Feature[] = [];
    const bb: GeoJSON.Feature[] = [];
    for (const e of bundle.geo.elements) {
      const h = snapshot.element_health[e.id];
      const c = h ? HEALTH_HEX[h] : e.kind === "nap" ? "#3A6FA8" : "#5E86C9";
      els.push({ type: "Feature", properties: { id: e.id, k: e.kind, c, dead: e.id === deadOlt ? 1 : 0 }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } });
      const parent = e.parent ? bundle.elementById.get(e.parent) : undefined;
      if (parent) {
        const w = e.kind === "pon" ? 2.4 : e.kind === "splitter" ? (e.tier === 1 ? 2 : 1.6) : 1;
        bb.push({
          type: "Feature",
          properties: { c: h && h !== "healthy" ? HEALTH_HEX[h] : "#2E4A86", w },
          geometry: { type: "LineString", coordinates: [[parent.lon, parent.lat], [e.lon, e.lat]] },
        });
      }
    }
    (map.getSource("elements") as GeoJSONSource).setData({ type: "FeatureCollection", features: els });
    (map.getSource("backbone") as GeoJSONSource).setData({ type: "FeatureCollection", features: overlays.backbone ? bb : [] });
  }

  function applyOverlays() {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const { snapshot, bundle, overlays, selected, compact, focus } = propsRef.current;

    // Incident halos: sized by blast radius, click to open.
    const seen = new Set<string>();
    const labelled = new Set(
      [...snapshot.incidents]
        .filter((i) => i.state !== "resolved")
        .sort((a, b) => b.rank_score - a.rank_score)
        .slice(0, 3)
        .map((i) => i.id)
    );
    if (overlays.incidents) {
      for (const inc of snapshot.incidents) {
        if (inc.state === "resolved" || !inc.top_suspect) continue;
        if (focus && selected?.kind === "incident" && selected.id !== inc.id) continue;
        const at = locate(bundle, inc.top_suspect);
        if (!at) continue;
        seen.add(inc.id);
        const size = inc.observed_count + inc.inferred_count;
        const r = Math.round(Math.min(64, 18 + Math.sqrt(size) * 3.2));
        const col = inc.state === "repairing" || inc.state === "verifying" ? BRAND.watch : inc.fault_kind === "power_outage" ? BRAND.record : BRAND.critical;
        const isSel = selected?.kind === "incident" && selected.id === inc.id;
        let m = incidentMarkers.current.get(inc.id);
        if (!m) {
          const d = document.createElement("button");
          d.type = "button";
          d.className = "group relative grid place-items-center";
          d.addEventListener("click", (ev) => {
            ev.stopPropagation();
            propsRef.current.onSelect?.({ kind: "incident", id: inc.id });
          });
          m = new maplibregl.Marker({ element: d }).setLngLat(at).addTo(map);
          incidentMarkers.current.set(inc.id, m);
        }
        m.setLngLat(at);
        // Labelled incidents sit above neighbouring halos and crews so their text stays legible.
        m.getElement().style.zIndex = isSel ? "30" : !compact && labelled.has(inc.id) ? "28" : "20";
        const label = compact || (!labelled.has(inc.id) && !isSel)
          ? ""
          : `<span style="position:absolute;top:${r / 2 + 6}px;white-space:nowrap;padding:2px 7px;border-radius:999px;background:rgba(5,11,29,.88);border:1px solid ${col}66;color:#EEF3FF;font:700 10.5px 'Source Sans 3',sans-serif">${inc.id} · ${
              inc.fault_kind ? FAULT_LABEL[inc.fault_kind] : "investigating"
            }${inc.peso_exposure ? ` · ${pesoCompact(inc.peso_exposure)}` : ""}</span>`;
        m.getElement().style.width = `${r}px`;
        m.getElement().style.height = `${r}px`;
        m.getElement().innerHTML =
          `<span style="position:absolute;inset:0;border-radius:999px;background:${col}1f;border:${isSel ? 2.5 : 1.5}px solid ${isSel ? BRAND.globeSky : col}"></span>` +
          `<span class="animate-halo" style="position:absolute;inset:0;border-radius:999px;border:1.5px solid ${col}"></span>` +
          `<span style="position:relative;width:7px;height:7px;border-radius:99px;background:${col};box-shadow:0 0 0 3px #040918"></span>` +
          label;
        m.getElement().title = `${inc.id} — ${size} lines`;
      }
    }
    for (const [id, m] of incidentMarkers.current) {
      if (!seen.has(id)) {
        m.remove();
        incidentMarkers.current.delete(id);
      }
    }

    // Crews driving from the exchange to the site.
    const crewSeen = new Set<string>();
    const routes: GeoJSON.Feature[] = [];
    if (overlays.crews) {
      for (const c of snapshot.crews) {
        if (c.lat === null || c.lon === null) continue;
        crewSeen.add(c.job_id);
        if (c.state === "enroute" && c.from_lat !== null && c.from_lon !== null && c.to_lat !== null && c.to_lon !== null) {
          routes.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[c.lon, c.lat], [c.to_lon, c.to_lat]] } });
        }
        let m = crewMarkers.current.get(c.job_id);
        if (!m) {
          const d = document.createElement("div");
          d.style.zIndex = "25";
          m = new maplibregl.Marker({ element: d }).setLngLat([c.lon, c.lat]).addTo(map);
          crewMarkers.current.set(c.job_id, m);
        }
        m.setLngLat([c.lon, c.lat]);
        const onsite = c.state === "onsite";
        m.getElement().innerHTML = `<div style="display:flex;align-items:center;gap:4px;padding:3px 7px 3px 5px;border-radius:999px;background:${
          onsite ? BRAND.healthy : BRAND.watch
        };color:#040918;font:800 10px 'Source Sans 3',sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.5)">${TRUCK}${
          onsite ? "On site" : `${Math.round(c.eta_min)}m`
        }</div>`;
        m.getElement().title = `Crew ${c.vendor_id} → ${c.target_element} · ${c.state}`;
      }
    }
    for (const [id, m] of crewMarkers.current) {
      if (!crewSeen.has(id)) {
        m.remove();
        crewMarkers.current.delete(id);
      }
    }
    (map.getSource("routes") as GeoJSONSource).setData({ type: "FeatureCollection", features: routes });
  }

  function applyFocus() {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const { focus, bundle } = propsRef.current;
    const feats: GeoJSON.Feature[] = [];
    if (focus) {
      for (const [ids, e] of [
        [focus.inferred, "inferred"],
        [focus.observed, "observed"],
      ] as const) {
        for (const id of ids) {
          const l = bundle.lineById.get(id);
          if (l) feats.push({ type: "Feature", properties: { id, e }, geometry: { type: "Point", coordinates: [l.lon, l.lat] } });
        }
      }
    }
    (map.getSource("focus") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  }

  function applySelected() {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const { selected, bundle, focus } = propsRef.current;
    let at: [number, number] | null = null;
    if (selected && (selected.kind === "element" || selected.kind === "line")) at = locate(bundle, selected.id);
    if (!at && focus?.suspect) at = locate(bundle, focus.suspect);
    (map.getSource("selected") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: at ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } }] : [],
    });
  }

  useEffect(() => {
    applyCities();
    applyNetwork();
    applyOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.snapshot, p.layer, p.overlays, p.bundle]);
  useEffect(() => {
    applyNetwork();
    applyFocus();
    applySelected();
    applyOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus, p.selected]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current || !p.fit) return;
    map.fitBounds(p.fit.bounds, { padding: p.padding ?? DEFAULT_PAD, duration: 900, maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fit?.key]);

  return <div ref={el} className="absolute inset-0" />;
}

const TRUCK =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
