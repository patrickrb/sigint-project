"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

interface Alert {
  id: string;
  severity: string;
  message: string;
  acknowledgedAt: string | null;
  createdAt: string;
  rule?: { name: string };
  sender?: { name: string };
}

const severityConfig: Record<string, { icon: typeof AlertTriangle; variant: string; pulse: boolean }> = {
  CRITICAL: { icon: AlertTriangle, variant: "destructive", pulse: true },
  WARNING: { icon: AlertCircle, variant: "warning", pulse: false },
  INFO: { icon: Info, variant: "default", pulse: false },
};

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

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
        <Info className="h-5 w-5 opacity-40" />
        <p className="text-sm">No alerts</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert, index) => {
        const config = severityConfig[alert.severity] || severityConfig.INFO;
        const Icon = config.icon;
        const isUnacknowledgedCritical = alert.severity === "CRITICAL" && !alert.acknowledgedAt;

        return (
          <div
            key={alert.id}
            className={`flex items-start gap-3 rounded-md border px-4 py-3 animate-slide-in ${
              isUnacknowledgedCritical
                ? "border-destructive/30 bg-destructive/5"
                : "border-border/50 bg-muted/30"
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className={`mt-0.5 ${config.pulse && !alert.acknowledgedAt ? "animate-pulse" : ""}`}>
              <Icon
                className={`h-4 w-4 ${
                  alert.severity === "CRITICAL"
                    ? "text-destructive"
                    : alert.severity === "WARNING"
                      ? "text-warning"
                      : "text-primary"
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{alert.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(alert.createdAt)}
                {alert.rule && ` · ${alert.rule.name}`}
                {alert.acknowledgedAt && (
                  <span className="text-accent"> · Acknowledged</span>
                )}
              </p>
            </div>
            <Badge variant={config.variant as any}>
              {alert.severity === "CRITICAL" ? "Critical" : alert.severity === "WARNING" ? "Warning" : "Info"}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
