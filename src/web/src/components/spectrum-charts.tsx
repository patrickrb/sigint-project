"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { onDataChanged } from "@/lib/events";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const CHART_COLORS = {
  primary: "#3b82f6",
  accent: "#22c55e",
  warning: "#f59e0b",
  destructive: "#ef4444",
  purple: "#a855f7",
  cyan: "#06b6d4",
};

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{entry.value} dBm</span>
        </div>
      ))}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface BandEntry {
  band: string;
  avgPower: number;
  minPower: number;
  maxPower: number;
  count: number;
}

// Color by power level: blue (quiet) → green (normal) → yellow (elevated) → red (anomaly)
function bandPowerColor(power: number): string {
  if (power >= -30) return CHART_COLORS.destructive;
  if (power >= -50) return CHART_COLORS.warning;
  if (power >= -70) return CHART_COLORS.accent;
  return CHART_COLORS.primary;
}

export function SpectrumBandChart() {
  const { data: session } = useSession();
  const [data, setData] = useState<BandEntry[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/spectrum-bands?minutes=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.bands || []);
      }
    } catch (err) {
      console.error("[spectrum-charts]", err);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No spectrum band data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="band"
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => `${v}`}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="avgPower" name="Avg Power" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={bandPowerColor(entry.avgPower)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface AnomalyTimelinePoint {
  time: string;
  count: number;
}

export function SpectrumAnomalyTimeline() {
  const { data: session } = useSession();
  const [data, setData] = useState<AnomalyTimelinePoint[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        `${apiUrl}/api/observations/timeline?minutes=60&protocol=spectrum-anomaly`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const json = await res.json();
        setData(json.timeline || []);
      }
    } catch (err) {
      console.error("[spectrum-charts]", err);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No anomaly activity yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="anomalyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.warning} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.warning} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="count"
          name="Anomalies"
          stroke={CHART_COLORS.warning}
          strokeWidth={2}
          fill="url(#anomalyGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
