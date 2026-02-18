"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { onDataChanged } from "@/lib/events";
import { SpectrumBandChart, SpectrumAnomalyTimeline } from "@/components/spectrum-charts";
import { Waves, AlertTriangle, BarChart3, Activity } from "lucide-react";
import { timeAgo, formatFrequency } from "@/lib/utils";

interface SpectrumAnomaly {
  id: string;
  observedAt: string;
  receivedAt: string;
  frequencyHz: string | null;
  rssi: number | null;
  noise: number | null;
  classification: string;
  fields: Record<string, unknown>;
}

export default function SpectrumPage() {
  const { data: session } = useSession();
  const [anomalies, setAnomalies] = useState<SpectrumAnomaly[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchAnomalies = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        `${apiUrl}/api/observations?protocol=spectrum-anomaly&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const json = await res.json();
        setAnomalies(json.observations || []);
      }
    } catch {}
  }, [token, apiUrl]);

  useEffect(() => {
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 10000);
    const unsub = onDataChanged(fetchAnomalies);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchAnomalies]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Waves className="h-6 w-6 text-purple-400" />
            Spectrum Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            Wideband RF spectrum analysis and anomaly detection
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse-dot" />
          <span className="text-sm font-medium text-purple-400">SCANNING</span>
        </div>
      </div>

      {/* Band summary + Anomaly timeline */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-purple-400" />
              Band Power Levels
              <span className="text-xs font-normal text-muted-foreground">(last 60 min)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <SpectrumBandChart />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-warning" />
              Anomaly Activity
              <span className="text-xs font-normal text-muted-foreground">(last 60 min)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <SpectrumAnomalyTimeline />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent anomalies table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Recent Spectrum Anomalies
          </CardTitle>
        </CardHeader>
        <CardContent>
          {anomalies.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Waves className="h-8 w-8 opacity-30" />
              <p className="text-sm">No spectrum anomalies detected</p>
              <p className="text-xs">Anomalies will appear here when the sweep adapter detects unusual RF activity</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid items-center border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground"
                style={{ gridTemplateColumns: "120px 100px 80px 80px 80px 80px 52px" }}
              >
                <span>Time</span>
                <span>Band</span>
                <span>Frequency</span>
                <span>Measured</span>
                <span>Baseline</span>
                <span>Deviation</span>
                <span>Type</span>
              </div>
              {anomalies.map((a) => {
                const fields = a.fields || {};
                return (
                  <div
                    key={a.id}
                    className="grid items-center border-b border-border/40 px-3 py-2 text-xs last:border-b-0 hover:bg-card/80"
                    style={{ gridTemplateColumns: "120px 100px 80px 80px 80px 80px 52px" }}
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {timeAgo(a.receivedAt)}
                    </span>
                    <span className="font-medium">{String(fields.band || "—")}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatFrequency(a.frequencyHz ? Number(a.frequencyHz) : null)}
                    </span>
                    <span className="font-mono tabular-nums">
                      {a.rssi != null ? `${a.rssi} dBm` : "—"}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {a.noise != null ? `${a.noise} dBm` : "—"}
                    </span>
                    <span className="font-mono tabular-nums text-warning">
                      {fields.deviationSigma != null ? `${fields.deviationSigma}σ` : "—"}
                    </span>
                    <Badge variant={String(fields.anomalyType) === "power-spike" ? "warning" : "muted"}>
                      {String(fields.anomalyType || "—")}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
