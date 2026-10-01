"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/client-api";
import { browserSupabase } from "@/lib/supabase/browser";
import type { Snapshot } from "@/lib/voting/types";

export function useLiveSession() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const accept = useCallback((next: Snapshot) => { setData(next); setError(null); }, []);
  const sessionId = data?.session.id;

  useEffect(() => {
    let active = true;
    let fetching = false;
    let queued = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      if (!active) return;
      if (fetching) { queued = true; return; }
      fetching = true;
      try {
        const next = await api<Snapshot>("/api/session");
        if (active) { setData(next); setError(null); }
      } catch (err) {
        if (active) {
          setError(errorMessage(err));
          if (err instanceof ApiError && err.code === "no_session") setData(null);
        }
      } finally {
        fetching = false;
        if (active) {
          setLoading(false);
          if (queued) { queued = false; void update(); }
        }
      }
    };
    refreshRef.current = () => { void update(); };
    void update();
    const recover = () => {
      // Reconcile status and session rollover even if a Realtime event was missed.
      retryTimer = setTimeout(() => { void update(); recover(); }, 5_000);
    };
    recover();
    const onFocus = () => { if (document.visibilityState === "visible") void update(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onFocus);
      refreshRef.current = () => {};
    };
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    const db = browserSupabase();
    if (!db) return;
    let active = true;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    // Separate instances also avoid channel reuse during React Strict Mode cleanup.
    const nonce = crypto.getRandomValues(new Uint32Array(2)).join("-");
    const channel = db.channel(`vote-totals-${sessionId}-${nonce}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vote_totals", filter: `session_id=eq.${sessionId}` }, () => {
        if (!debounceTimer) debounceTimer = setTimeout(() => { debounceTimer = undefined; refresh(); }, 200);
      })
      .subscribe((status) => {
        if (!active) return;
        const connected = status === "SUBSCRIBED";
        setLive(connected);
        if (connected) refresh();
      });
    return () => {
      active = false;
      clearTimeout(debounceTimer);
      void db.removeChannel(channel);
    };
  }, [sessionId, refresh]);

  return { data, loading, error, live: live && !!data, refresh, accept };
}
