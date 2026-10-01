"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client-api";
import { browserSupabase } from "@/lib/supabase/browser";
import type { Snapshot } from "@/lib/voting/types";

export function useLiveSession() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let fetching = false;
    let queued = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      if (!active) return;
      if (fetching) { queued = true; return; }
      fetching = true;
      try {
        const next = await api<Snapshot>("/api/session");
        if (active) { setData(next); setError(null); }
      } catch (err) {
        if (active) { setError(errorMessage(err)); }
      } finally {
        fetching = false;
        if (active) {
          setLoading(false);
          if (queued) { queued = false; void update(); }
        }
      }
    };
    refreshRef.current = () => { void update(); };
    // Coalesce bursts of vote events into one small, consistent snapshot fetch.
    const scheduleRefresh = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => { debounceTimer = undefined; void update(); }, 200);
    };
    void update();
    const db = browserSupabase();
    const channel = db?.channel(`vote-totals-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vote_totals" }, scheduleRefresh)
      .subscribe((status) => {
        if (!active) return;
        const connected = status === "SUBSCRIBED";
        liveRef.current = connected;
        setLive(connected);
        if (connected) void update(); // Close the initial-fetch/subscription gap.
      });
    const recover = () => {
      // Reconcile status and session rollover even if a Realtime event was missed.
      retryTimer = setTimeout(() => { void update(); recover(); }, liveRef.current ? 20_000 : 5_000);
    };
    recover();
    const onFocus = () => { if (document.visibilityState === "visible") void update(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      clearTimeout(debounceTimer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onFocus);
      if (db && channel) void db.removeChannel(channel);
      refreshRef.current = () => {};
      liveRef.current = false;
    };
  }, [refresh]);

  return { data, loading, error, live, refresh };
}
