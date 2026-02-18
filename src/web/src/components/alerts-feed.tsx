"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Alert {
  id: string;
  severity: string;
  message: string;
  acknowledgedAt: string | null;
  createdAt: string;
  rule?: { name: string };
  sender?: { name: string };
}

export function AlertsFeed({ limit = 10 }: { limit?: number }) {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (!session) return;
    const token = (session.user as any).apiToken;
    if (!token) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    async function fetchAlerts() {
      try {
        const res = await fetch(`${apiUrl}/api/alerts?limit=${limit}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.alerts || data);
        }
      } catch {}
    }

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [session, limit]);

  const severityBadge = (s: string) => {
    switch (s) {
      case "CRITICAL":
        return <Badge variant="destructive">Critical</Badge>;
      case "WARNING":
        return <Badge variant="warning">Warning</Badge>;
      default:
        return <Badge variant="default">Info</Badge>;
    }
  };

  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground">No alerts</p>;
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/30 px-4 py-3"
        >
          <div className="mt-0.5">{severityBadge(alert.severity)}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{alert.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(alert.createdAt)}
              {alert.rule && ` · ${alert.rule.name}`}
              {alert.acknowledgedAt && " · Acknowledged"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
