"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { onDataChanged } from "@/lib/events";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const CHART_COLORS = {
  primary: "#3b82f6",
  accent: "#22c55e",
  warning: "#f59e0b",
  destructive: "#ef4444",
  muted: "#a1a1a1",
  purple: "#a855f7",
  cyan: "#06b6d4",
  pink: "#ec4899",
};

const PROTOCOL_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.accent,
  CHART_COLORS.warning,
  CHART_COLORS.purple,
  CHART_COLORS.cyan,
  CHART_COLORS.pink,
  CHART_COLORS.destructive,
  CHART_COLORS.muted,
];

interface TimelinePoint {
  time: string;
  count: number;
}

interface ClassificationTimelinePoint {
  time: string;
  KNOWN: number;
  UNKNOWN: number;
  PENDING: number;
}

interface ProtocolEntry {
  protocol: string;
  count: number;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted-foreground">{typeof label === "string" && label.includes("T") ? formatTime(label) : label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline() {
  const { data: session } = useSession();
  const [data, setData] = useState<TimelinePoint[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchTimeline = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/timeline?minutes=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.timeline || []);
      }
    } catch {}
  }, [token, apiUrl]);

  useEffect(() => {
    fetchTimeline();
    const interval = setInterval(fetchTimeline, 5000);
    const unsub = onDataChanged(fetchTimeline);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchTimeline]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No activity data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
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
          name="Observations"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          fill="url(#activityGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ClassificationTimeline() {
  const { data: session } = useSession();
  const [data, setData] = useState<ClassificationTimelinePoint[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/classification-timeline?minutes=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.timeline || []);
      }
    } catch {}
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No classification data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
        <Bar dataKey="KNOWN" name="Known" stackId="a" fill={CHART_COLORS.accent} radius={[0, 0, 0, 0]} />
        <Bar dataKey="PENDING" name="Pending" stackId="a" fill={CHART_COLORS.muted} radius={[0, 0, 0, 0]} />
        <Bar dataKey="UNKNOWN" name="Unknown" stackId="a" fill={CHART_COLORS.warning} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProtocolBreakdown() {
  const { data: session } = useSession();
  const [data, setData] = useState<ProtocolEntry[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/protocols`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.protocols || []);
      }
    } catch {}
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No protocol data yet
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex h-full items-center gap-4">
      <div className="h-full w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="protocol"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              strokeWidth={0}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PROTOCOL_COLORS[i % PROTOCOL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {data.map((entry, i) => (
          <div key={entry.protocol} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: PROTOCOL_COLORS[i % PROTOCOL_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.protocol}</span>
            <span className="shrink-0 font-mono tabular-nums">{entry.count}</span>
            <span className="shrink-0 w-8 text-right text-muted-foreground tabular-nums">
              {total > 0 ? `${Math.round((entry.count / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RSSIBucket {
  range: string;
  count: number;
}

const RSSI_BAR_COLORS: Record<string, string> = {
  "Below -90": CHART_COLORS.destructive,
  "-90 to -81": CHART_COLORS.destructive,
  "-80 to -71": CHART_COLORS.warning,
  "-70 to -61": CHART_COLORS.warning,
  "-60 to -51": CHART_COLORS.cyan,
  "-50 to -41": CHART_COLORS.accent,
  "-40 to -31": CHART_COLORS.accent,
  "-30+": CHART_COLORS.accent,
};

export function RSSIDistribution() {
  const { data: session } = useSession();
  const [data, setData] = useState<RSSIBucket[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/rssi-distribution`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.distribution || []);
      }
    } catch {}
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No signal data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="range"
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={40}
        />
        <YAxis
          tick={{ fill: "#a1a1a1", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" name="Observations" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={RSSI_BAR_COLORS[entry.range] || CHART_COLORS.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
