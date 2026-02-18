"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Wifi, HelpCircle, Radio } from "lucide-react";

interface Stats {
  totalObservations: number;
  knownCount: number;
  unknownCount: number;
  pendingCount: number;
  activeSenders: number;
  observationsPerMinute: number;
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [displayed, setDisplayed] = useState(value);
  const [animating, setAnimating] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value !== prevRef.current) {
      setAnimating(true);
      setDisplayed(value);
      prevRef.current = value;
      const timer = setTimeout(() => setAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <span className={`${className} ${animating ? "animate-number-up" : ""}`} key={displayed}>
      {displayed.toLocaleString()}
    </span>
  );
}

export function LiveStats() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!session) return;
    const token = (session.user as any).apiToken;
    if (!token) return;

    async function fetchStats() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const res = await fetch(`${apiUrl}/api/observations/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setStats(await res.json());
      } catch {}
    }

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [session]);

  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-6">
              <div className="h-4 w-20 rounded bg-muted" />
              <div className="mt-2 h-8 w-16 rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const items = [
    {
      label: "Obs/min",
      value: stats.observationsPerMinute,
      color: "text-primary",
      icon: Activity,
      glow: stats.observationsPerMinute > 0,
    },
    {
      label: "Known Devices",
      value: stats.knownCount,
      color: "text-accent",
      icon: Wifi,
      glow: false,
    },
    {
      label: "Unknown",
      value: stats.unknownCount,
      color: "text-warning",
      icon: HelpCircle,
      glow: false,
    },
    {
      label: "Active Senders",
      value: stats.activeSenders,
      color: "text-foreground",
      icon: Radio,
      glow: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label} className={item.glow ? "animate-glow" : ""}>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <Icon className={`h-4 w-4 ${item.color} opacity-50`} />
              </div>
              <AnimatedNumber
                value={item.value}
                className={`mt-1 block text-3xl font-bold tabular-nums ${item.color}`}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
