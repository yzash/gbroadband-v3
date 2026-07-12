"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { OpsSnapshot } from "@/lib/types";
import type { Role } from "@/lib/roles";

interface AppStateValue {
  snapshot: OpsSnapshot | null;
  connected: boolean;
  role: Role;
  setRole: (r: Role) => void;
  /** POST a clock command; snapshot refreshes via stream. */
  setClock: (cmd: { speed?: 0 | 1 | 4 | 16; running?: boolean; advance6h?: boolean }) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function useApp(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within <AppStateProvider>");
  return v;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [role, setRoleState] = useState<Role>("noc_lead");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Restore role from localStorage.
  useEffect(() => {
    const saved = window.localStorage.getItem("sdal.role") as Role | null;
    if (saved) setRoleState(saved);
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    window.localStorage.setItem("sdal.role", r);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) setSnapshot(await res.json());
    } catch {
      /* transient */
    }
  }, []);

  // Connect SSE, fall back to polling if it drops.
  useEffect(() => {
    let disposed = false;

    function startPolling() {
      if (pollRef.current) return;
      pollRef.current = setInterval(refresh, 2000);
      refresh();
    }
    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    function connect() {
      try {
        const es = new EventSource("/api/stream");
        esRef.current = es;
        es.onopen = () => {
          if (disposed) return;
          setConnected(true);
          stopPolling();
        };
        es.onmessage = (ev) => {
          if (disposed) return;
          try {
            setSnapshot(JSON.parse(ev.data));
          } catch {
            /* ignore malformed frame */
          }
        };
        es.onerror = () => {
          setConnected(false);
          es.close();
          esRef.current = null;
          startPolling();
          if (!disposed) setTimeout(connect, 4000); // retry SSE
        };
      } catch {
        startPolling();
      }
    }

    connect();
    return () => {
      disposed = true;
      esRef.current?.close();
      stopPolling();
    };
  }, [refresh]);

  const setClock = useCallback(
    async (cmd: { speed?: 0 | 1 | 4 | 16; running?: boolean; advance6h?: boolean }) => {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cmd),
      });
      if (res.ok) setSnapshot(await res.json());
    },
    []
  );

  const reset = useCallback(async () => {
    const res = await fetch("/api/reset", { method: "POST" });
    if (res.ok) setSnapshot(await res.json());
  }, []);

  return (
    <Ctx.Provider value={{ snapshot, connected, role, setRole, setClock, reset, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
