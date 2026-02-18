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

export default function AlertsPage() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  async function fetchAlerts() {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/alerts?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || data);
      }
    } catch {}
  }

  useEffect(() => {
    fetchAlerts();
  }, [session]);

  async function handleAcknowledge(id: string) {
    if (!token) return;
    await fetch(`${apiUrl}/api/alerts/${id}/ack`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchAlerts();
  }

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-sm text-muted-foreground">Alert history and acknowledgement</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Severity</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Message</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Rule</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No alerts yet.
                </td>
              </tr>
            ) : (
              alerts.map((a) => (
                <tr key={a.id} className="border-b border-border/50">
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-3">{severityBadge(a.severity)}</td>
                  <td className="max-w-md px-4 py-3">{a.message}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.rule?.name || "—"}</td>
                  <td className="px-4 py-3">
                    {a.acknowledgedAt ? (
                      <Badge variant="muted">Ack'd</Badge>
                    ) : (
                      <Badge variant="warning">Open</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!a.acknowledgedAt && (
                      <button
                        onClick={() => handleAcknowledge(a.id)}
                        className="text-sm text-primary hover:underline"
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
