"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatFrequency, truncateSignature } from "@/lib/utils";

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
  const eventSourceRef = useRef<EventSource | null>(null);

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
      .then((data) => setObservations(data.observations || data))
      .catch(() => {});

    // Connect to SSE
    const es = new EventSource(`${apiUrl}/api/events?token=${token}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener("observation", (e) => {
      try {
        const obs = JSON.parse(e.data);
        setObservations((prev) => [obs, ...prev].slice(0, 100));
      } catch {}
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [session]);

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
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Recent Observations</h2>
        <span
          className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-accent" : "bg-destructive"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Protocol</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Frequency</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">RSSI</th>
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
                <tr key={obs.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 tabular-nums">{formatDate(obs.receivedAt)}</td>
                  <td className="px-4 py-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{obs.protocol}</code>
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatFrequency(obs.frequencyHz ? Number(obs.frequencyHz) : null)}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{obs.rssi != null ? `${obs.rssi} dBm` : "—"}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs text-muted-foreground">{truncateSignature(obs.signature)}</code>
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
