"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { onDataChanged } from "@/lib/events";
import {
  AreaChart,
  Area,
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
  purple: "#a855f7",
  cyan: "#06b6d4",
};

const CHANNEL_COLORS = [CHART_COLORS.primary, CHART_COLORS.cyan, CHART_COLORS.purple];

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted-foreground">
        {typeof label === "string" && label.includes("T") ? formatTime(label) : label}
      </p>
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

interface TimelinePoint {
  time: string;
  count: number;
}

export function BleActivityTimeline() {
  const { data: session } = useSession();
  const [data, setData] = useState<TimelinePoint[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      // Fetch timeline filtered to BLE protocols
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
    fetchData();
    const interval = setInterval(fetchData, 10000);
    const unsub = onDataChanged(fetchData);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchData]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No BLE activity data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="bleGrad" x1="0" y1="0" x2="0" y2="1">
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
          name="BLE Observations"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          fill="url(#bleGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface ChannelData {
  channel: string;
  count: number;
}

export function BleChannelDistribution() {
  const { data: session } = useSession();
  const [data, setData] = useState<ChannelData[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/ble-devices?minutes=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const devices = json.devices || [];

        // Aggregate by channel from device fields
        const channelCounts: Record<string, number> = {};
        for (const d of devices) {
          const ch = d.fields?.channel;
          if (ch != null) {
            const key = `Ch ${ch}`;
            channelCounts[key] = (channelCounts[key] || 0) + d.count;
          }
        }

        const result = Object.entries(channelCounts)
          .map(([channel, count]) => ({ channel, count }))
          .sort((a, b) => a.channel.localeCompare(b.channel));

        setData(result);
      }
    } catch {}
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
        No channel data yet
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
              nameKey="channel"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              strokeWidth={0}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        {data.map((entry, i) => (
          <div key={entry.channel} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }}
            />
            <span className="text-muted-foreground">{entry.channel}</span>
            <span className="font-mono tabular-nums">{entry.count}</span>
            <span className="text-muted-foreground tabular-nums">
              {total > 0 ? `${Math.round((entry.count / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
