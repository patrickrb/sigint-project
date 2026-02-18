"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalBar } from "@/components/ui/signal-bar";
import {
  formatDate,
  formatFrequency,
  truncateSignature,
  rssiToLevel,
  timeAgo,
  protocolColor,
} from "@/lib/utils";

interface Observation {
  id: string;
  protocol: string;
  frequencyHz: string | null;
  rssi: number | null;
  signature: string;
  classification: string;
  observedAt: string;
  receivedAt: string;
  fields: Record<string, unknown>;
  sender?: { name: string };
}

export function ObservationsFeed() {
  const { data: session } = useSession();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [connected, setConnected] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [lastSignalTime, setLastSignalTime] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Tick every second to update "last signal" display
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleNewObservation = useCallback((obs: Observation) => {
    setObservations((prev) => [obs, ...prev].slice(0, 100));
    setLastSignalTime(obs.receivedAt);
    setNewIds((prev) => {
      const next = new Set(prev);
      next.add(obs.id);
      return next;
    });
    // Clear flash after animation completes
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(obs.id);
        return next;
      });
    }, 1500);
  }, []);

  useEffect(() => {
    if (!session) return;
    const token = (session.user as any).apiToken;
    if (!token) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    // Fetch initial observations
    fetch(`${apiUrl}/api/observations?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const obs = data.observations || data;
        setObservations(obs);
        if (obs.length > 0) setLastSignalTime(obs[0].receivedAt);
      })
      .catch(() => {});

    // Connect to SSE
    const es = new EventSource(`${apiUrl}/api/events?token=${token}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener("observation", (e) => {
      try {
        const obs = JSON.parse(e.data);
        handleNewObservation(obs);
      } catch {}
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [session, handleNewObservation]);

  const classificationBadge = (c: string) => {
    switch (c) {
      case "KNOWN":
        return <Badge variant="success">Known</Badge>;
      case "UNKNOWN":
        return <Badge variant="warning">Unknown</Badge>;
      default:
        return <Badge variant="muted">Pending</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Recent Observations</h2>
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Badge variant="live" className="gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
                LIVE
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
                DISCONNECTED
              </Badge>
            )}
          </div>
        </div>
        {lastSignalTime && (
          <span className="text-xs tabular-nums text-muted-foreground">
            Last signal {timeAgo(lastSignalTime)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Protocol</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Frequency</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Signal</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Signature</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {observations.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No observations yet. Start a sender to see live data.
                </td>
              </tr>
            ) : (
              observations.map((obs) => (
                <tr
                  key={obs.id}
                  className={`border-b border-border/50 hover:bg-muted/30 ${
                    newIds.has(obs.id) ? "animate-row-flash" : ""
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-xs tabular-nums">
                    {formatDate(obs.receivedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${protocolColor(obs.protocol)}`}
                    >
                      {obs.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs tabular-nums">
                    {formatFrequency(obs.frequencyHz ? Number(obs.frequencyHz) : null)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <SignalBar level={rssiToLevel(obs.rssi)} />
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {obs.rssi != null ? `${obs.rssi}` : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <code className="font-mono text-xs text-muted-foreground">
                      {truncateSignature(obs.signature)}
                    </code>
                  </td>
                  <td className="px-4 py-2">{classificationBadge(obs.classification)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
