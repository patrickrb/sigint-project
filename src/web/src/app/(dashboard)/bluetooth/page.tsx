"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignalBar } from "@/components/ui/signal-bar";
import { onDataChanged } from "@/lib/events";
import { emitDataChanged } from "@/lib/events";
import { BleActivityTimeline, BleChannelDistribution } from "@/components/ble-charts";
import { Bluetooth, Radio, Activity, PieChart } from "lucide-react";
import { timeAgo, rssiToLevel, truncateSignature } from "@/lib/utils";

interface BleDevice {
  signature: string;
  protocol: string;
  classification: string;
  avgRssi: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  frequencyHz: string | null;
  fields: Record<string, unknown>;
}

export default function BluetoothPage() {
  const { data: session } = useSession();
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [expandedSigs, setExpandedSigs] = useState<Set<string>>(new Set());
  const [approvingSigs, setApprovingSigs] = useState<Set<string>>(new Set());

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchDevices = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/observations/ble-devices?minutes=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setDevices(json.devices || []);
      }
    } catch (err) {
      console.error("[bluetooth]", err);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 10000);
    const unsub = onDataChanged(fetchDevices);
    return () => { clearInterval(interval); unsub(); };
  }, [fetchDevices]);

  const toggleExpand = useCallback((sig: string) => {
    setExpandedSigs((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });
  }, []);

  const handleApprove = useCallback(async (device: BleDevice) => {
    if (!token) return;
    setApprovingSigs((prev) => new Set(prev).add(device.signature));
    try {
      // Find the latest observation for this signature and approve it
      const obsRes = await fetch(
        `${apiUrl}/api/observations?signature=${device.signature}&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (obsRes.ok) {
        const obsData = await obsRes.json();
        const obs = obsData.observations?.[0];
        if (obs) {
          const approveRes = await fetch(`${apiUrl}/api/observations/${obs.id}/approve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (approveRes.ok) {
            emitDataChanged();
          }
        }
      }
    } catch (err) {
      console.error("[bluetooth]", err);
    }
    setApprovingSigs((prev) => {
      const next = new Set(prev);
      next.delete(device.signature);
      return next;
    });
  }, [token, apiUrl]);

  const classificationBadge = (c: string) => {
    switch (c) {
      case "KNOWN": return <Badge variant="success">Known</Badge>;
      case "UNKNOWN": return <Badge variant="warning">Unknown</Badge>;
      default: return <Badge variant="muted">Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bluetooth className="h-6 w-6 text-blue-400" />
            Bluetooth Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            BLE device inventory and advertising channel activity
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse-dot" />
          <span className="text-sm font-medium text-blue-400">
            {devices.length} DEVICE{devices.length !== 1 ? "S" : ""}
          </span>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-blue-400" />
              BLE Activity
              <span className="text-xs font-normal text-muted-foreground">(last 60 min)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <BleActivityTimeline />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <PieChart className="h-4 w-4 text-blue-400" />
              Channel Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <BleChannelDistribution />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Device inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="h-4 w-4 text-blue-400" />
            BLE Device Inventory
            <span className="text-xs font-normal text-muted-foreground">
              ({devices.length} devices in last 60 min)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Bluetooth className="h-8 w-8 opacity-30" />
              <p className="text-sm">No BLE devices detected</p>
              <p className="text-xs">
                Devices will appear here when the BLE adapter captures advertising packets
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <div
                className="grid items-center border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground"
                style={{ gridTemplateColumns: "16px 120px 140px 70px 60px 80px 80px min-content" }}
              >
                <span />
                <span>Device</span>
                <span>Name</span>
                <span>Signal</span>
                <span>Seen</span>
                <span>Last Seen</span>
                <span>Mfg</span>
                <span>Status</span>
              </div>
              {devices.map((device) => {
                const isExpanded = expandedSigs.has(device.signature);
                const fields = device.fields as Record<string, unknown>;
                const macHash = String(fields?.macHash || "");
                const deviceName = String(fields?.deviceName || "");
                const manufacturer = String(fields?.manufacturerName || "");
                const advType = String(fields?.advType || "");
                const channel = fields?.channel;

                return (
                  <div key={device.signature} className="border-b border-border/40 last:border-b-0">
                    <div
                      className="grid cursor-pointer items-center px-3 py-2 hover:bg-card/80"
                      style={{ gridTemplateColumns: "16px 120px 140px 70px 60px 80px 80px min-content" }}
                      onClick={() => toggleExpand(device.signature)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>

                      <span className="truncate font-mono text-xs">
                        {macHash ? macHash.slice(0, 12) : truncateSignature(device.signature, 12)}
                      </span>

                      <span className="truncate text-xs">
                        {deviceName || <span className="text-muted-foreground">—</span>}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <SignalBar level={rssiToLevel(device.avgRssi)} />
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {Math.round(device.avgRssi)}
                        </span>
                      </div>

                      <span className="font-mono text-xs tabular-nums">{device.count}</span>

                      <span className="text-xs tabular-nums text-muted-foreground">
                        {timeAgo(device.lastSeen)}
                      </span>

                      <span className="truncate text-xs text-muted-foreground">
                        {manufacturer || "—"}
                      </span>

                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {classificationBadge(device.classification)}
                        {device.classification !== "KNOWN" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(device); }}
                            disabled={approvingSigs.has(device.signature)}
                            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            {approvingSigs.has(device.signature) ? "..." : "Approve"}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border/30 bg-muted/20 px-4 py-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
                          {macHash && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">MAC Hash</span>
                              <span className="font-mono font-medium">{macHash}</span>
                            </div>
                          )}
                          {advType && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">Adv Type</span>
                              <span className="font-mono font-medium">{advType}</span>
                            </div>
                          )}
                          {channel != null && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">Channel</span>
                              <span className="font-mono font-medium">Ch {String(channel)}</span>
                            </div>
                          )}
                          {fields?.txPower != null && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">TX Power</span>
                              <span className="font-mono font-medium">{String(fields.txPower)} dBm</span>
                            </div>
                          )}
                          {fields?.manufacturerId && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">Company ID</span>
                              <span className="font-mono font-medium">0x{String(fields.manufacturerId)}</span>
                            </div>
                          )}
                          {fields?.serviceUuids && (
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="text-muted-foreground">Services</span>
                              <span className="font-mono font-medium">
                                {Array.isArray(fields.serviceUuids) ? fields.serviceUuids.join(", ") : String(fields.serviceUuids)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-baseline gap-2 text-xs">
                            <span className="text-muted-foreground">First Seen</span>
                            <span className="font-mono font-medium">{timeAgo(device.firstSeen)}</span>
                          </div>
                          <div className="flex items-baseline gap-2 text-xs">
                            <span className="text-muted-foreground">Avg RSSI</span>
                            <span className="font-mono font-medium">{device.avgRssi} dBm</span>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Sig: <code className="font-mono text-xs">{device.signature}</code>
                        </div>
                      </div>
                    )}
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
