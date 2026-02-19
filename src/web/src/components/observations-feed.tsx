"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalBar } from "@/components/ui/signal-bar";
import {
  formatFrequency,
  truncateSignature,
  rssiToLevel,
  timeAgo,
  protocolColor,
} from "@/lib/utils";
import { emitDataChanged } from "@/lib/events";

interface Observation {
  id: string;
  protocol: string;
  frequencyHz: string | null;
  rssi: number | null;
  snr: number | null;
  noise: number | null;
  modulation: string | null;
  signature: string;
  classification: string;
  observedAt: string;
  receivedAt: string;
  fields: Record<string, unknown>;
  sender?: { name: string };
}

function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  const k = key.toLowerCase();
  if (k.includes("temperature") && k.endsWith("_c") && typeof value === "number") {
    const f = value * 9 / 5 + 32;
    return `${value}\u00B0C / ${f.toFixed(1)}\u00B0F`;
  }
  if (k.includes("temperature") && k.endsWith("_f") && typeof value === "number") return `${value}\u00B0F`;
  if (k.includes("humidity") && typeof value === "number") return `${value}%`;
  if (k.includes("wind") && k.includes("km") && typeof value === "number") return `${value} km/h`;
  if (k.includes("wind") && k.includes("mph") && typeof value === "number") return `${value} mph`;
  if (k.includes("wind") && k.includes("m_s") && typeof value === "number") return `${value} m/s`;
  if (k.includes("wind") && k.includes("dir") && typeof value === "number") return `${value}\u00B0`;
  if (k.includes("pressure") && k.includes("hpa") && typeof value === "number") return `${value} hPa`;
  if (k.includes("rain") && k.includes("mm") && typeof value === "number") return `${value} mm`;
  if (k === "battery_ok") return value ? "OK" : "Low";
  // BLE/spectrum fields — match actual camelCase keys from the data
  if (key === "macHash" && typeof value === "string") return `${value.slice(0, 12)}...`;
  if (key === "channel" && typeof value === "number") return `Ch ${value}`;
  if (key === "txPower" && typeof value === "number") return `${value} dBm`;
  if (key === "deviationSigma" && typeof value === "number") return `${value}σ`;
  if (key === "burstCount" && typeof value === "number") return `${value} bursts`;
  if (key === "dwellMs" && typeof value === "number") return `${value} ms`;
  if (key === "binWidthHz" && typeof value === "number") return `${(value / 1e6).toFixed(1)} MHz`;
  if (key === "baselinePower" && typeof value === "number") return `${value} dBm`;
  if (key === "measuredPower" && typeof value === "number") return `${value} dBm`;
  if (key === "meanPower" && typeof value === "number") return `${value} dBm`;
  if (key === "minPower" && typeof value === "number") return `${value} dBm`;
  if (key === "maxPower" && typeof value === "number") return `${value} dBm`;
  if (key === "peakPower" && typeof value === "number") return `${value} dBm`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const HIDDEN_FIELDS = new Set(["model", "time", "mic"]);

function snrQualityColor(snr: number | null): string | null {
  if (snr == null) return null;
  if (snr >= 20) return "bg-emerald-400";
  if (snr >= 10) return "bg-blue-400";
  if (snr >= 5) return "bg-amber-400";
  return "bg-red-400";
}

function snrQualityLabel(snr: number | null): string {
  if (snr == null) return "";
  if (snr >= 20) return "Excellent";
  if (snr >= 10) return "Good";
  if (snr >= 5) return "Fair";
  return "Poor";
}

export function ObservationsFeed({ compact = false }: { compact?: boolean }) {
  const { data: session } = useSession();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [connected, setConnected] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastSignalTime, setLastSignalTime] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const handleApprove = useCallback(async (obs: Observation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token) return;
    setApprovingIds((prev) => new Set(prev).add(obs.id));
    try {
      const res = await fetch(`${apiUrl}/api/observations/${obs.id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setObservations((prev) =>
          prev.map((o) =>
            o.signature === obs.signature ? { ...o, classification: "KNOWN" } : o
          )
        );
        emitDataChanged();
      }
    } catch {}
    setApprovingIds((prev) => {
      const next = new Set(prev);
      next.delete(obs.id);
      return next;
    });
  }, [token, apiUrl]);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleNewObservation = useCallback((obs: Observation) => {
    setObservations((prev) => [obs, ...prev].slice(0, 100));
    setLastSignalTime(obs.receivedAt);
    setNewIds((prev) => new Set(prev).add(obs.id));
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

    const es = new EventSource(`${apiUrl}/api/events?token=${token}`);
    eventSourceRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("observation", (e) => {
      try { handleNewObservation(JSON.parse(e.data)); } catch {}
    });

    return () => { es.close(); eventSourceRef.current = null; };
  }, [session, handleNewObservation]);

  const classificationBadge = (c: string) => {
    switch (c) {
      case "KNOWN": return <Badge variant="success">Known</Badge>;
      case "UNKNOWN": return <Badge variant="warning">Unknown</Badge>;
      default: return <Badge variant="muted">Pending</Badge>;
    }
  };

  const displayCount = compact ? 20 : 50;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Signal Feed</h2>
          {connected ? (
            <Badge variant="live" className="gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
              LIVE
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              OFFLINE
            </Badge>
          )}
        </div>
        {lastSignalTime && (
          <span className="text-xs tabular-nums text-muted-foreground">
            Last signal {timeAgo(lastSignalTime)}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        {/* Column header */}
        <div
          className="grid items-center border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground"
          style={{ gridTemplateColumns: "16px 130px minmax(80px, 1fr) 70px 100px 52px min-content" }}
        >
          <span />
          <span>Protocol</span>
          <span>Device</span>
          <span>Signal</span>
          <span className="hidden sm:block">Frequency</span>
          <span>Time</span>
          <span>Status</span>
        </div>

        {observations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
            <p className="text-sm">Waiting for signals...</p>
          </div>
        ) : (
          observations.slice(0, displayCount).map((obs) => {
            const isExpanded = expandedIds.has(obs.id);
            const model = obs.fields?.model;
            const isNew = newIds.has(obs.id);
            const borderColor =
              obs.classification === "KNOWN"
                ? "border-l-accent/60"
                : obs.classification === "UNKNOWN"
                  ? "border-l-warning/60"
                  : "border-l-border";

            return (
              <div
                key={obs.id}
                className={`border-b border-l-2 border-border/40 transition-colors last:border-b-0 hover:bg-card/80 ${borderColor} ${
                  isNew ? "animate-row-flash" : ""
                }`}
              >
                <div
                  className="grid cursor-pointer items-center px-3 py-2"
                  style={{ gridTemplateColumns: "16px 130px minmax(80px, 1fr) 70px 100px 52px min-content" }}
                  onClick={() => toggleExpand(obs.id)}
                >
                  {/* Chevron */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>

                  {/* Protocol */}
                  <span className="truncate">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${protocolColor(obs.protocol)}`}
                    >
                      {obs.protocol}
                    </span>
                  </span>

                  {/* Device / model */}
                  <span className="truncate text-xs text-muted-foreground">
                    {model ? String(model) : truncateSignature(obs.signature, 16)}
                  </span>

                  {/* Signal */}
                  <div className="flex items-center gap-1.5">
                    <SignalBar level={rssiToLevel(obs.rssi)} />
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {obs.rssi != null ? `${obs.rssi}` : "\u2014"}
                    </span>
                    {snrQualityColor(obs.snr) && (
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${snrQualityColor(obs.snr)}`}
                        title={`SNR: ${obs.snr} dB (${snrQualityLabel(obs.snr)})`}
                      />
                    )}
                  </div>

                  {/* Frequency */}
                  <span className="hidden truncate font-mono text-xs tabular-nums text-muted-foreground sm:block">
                    {formatFrequency(obs.frequencyHz ? Number(obs.frequencyHz) : null)}
                  </span>

                  {/* Time */}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {timeAgo(obs.receivedAt)}
                  </span>

                  {/* Status + Approve */}
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {classificationBadge(obs.classification)}
                    {obs.classification !== "KNOWN" && (
                      <button
                        onClick={(e) => handleApprove(obs, e)}
                        disabled={approvingIds.has(obs.id)}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {approvingIds.has(obs.id) ? "\u2022\u2022\u2022" : "Approve"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border/30 bg-muted/20 px-4 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
                      {Object.entries(obs.fields)
                        .filter(([key]) => !HIDDEN_FIELDS.has(key))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-baseline gap-2 text-xs">
                            <span className="text-muted-foreground">{formatFieldKey(key)}</span>
                            <span className="font-mono font-medium">{formatFieldValue(key, value)}</span>
                          </div>
                        ))}
                    </div>
                    {(obs.snr != null || obs.noise != null || obs.modulation) && (
                      <div className="mt-2 flex items-center gap-4 text-xs">
                        {obs.snr != null && (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${snrQualityColor(obs.snr)}`} />
                            <span className="text-muted-foreground">SNR:</span>
                            <span className="font-mono font-medium">{obs.snr} dB</span>
                            <span className="text-muted-foreground">({snrQualityLabel(obs.snr)})</span>
                          </div>
                        )}
                        {obs.noise != null && (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-muted-foreground">Noise:</span>
                            <span className="font-mono font-medium">{obs.noise} dBm</span>
                          </div>
                        )}
                        {obs.modulation && (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-muted-foreground">Modulation:</span>
                            <span className="font-mono font-medium">{obs.modulation}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      {obs.sender?.name && (
                        <span>Sender: <span className="font-medium text-foreground">{obs.sender.name}</span></span>
                      )}
                      <span>Sig: <code className="font-mono text-xs">{obs.signature}</code></span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
