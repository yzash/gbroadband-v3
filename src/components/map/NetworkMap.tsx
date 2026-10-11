"use client";

import dynamic from "next/dynamic";

/** MapLibre touches `window`, so it only ever renders in the browser. */
export const NetworkMap = dynamic(() => import("./NetworkMapGL"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-[#040918] text-xs text-ink-3">Loading Metro Manila…</div>
  ),
});
