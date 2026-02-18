"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveStats } from "@/components/live-stats";
import { ObservationsFeed } from "@/components/observations-feed";
import { AlertsFeed } from "@/components/alerts-feed";
import {
  ActivityTimeline,
  ClassificationTimeline,
  ProtocolBreakdown,
  RSSIDistribution,
  SNRDistribution,
  NoiseFloorTimeline,
} from "@/components/charts";
import { Activity, AlertTriangle, Radio, BarChart3, PieChart, Shield, Signal, Waves } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Radio className="h-6 w-6 text-primary" />
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Real-time RF telemetry overview</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-4 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
          <span className="text-sm font-medium text-accent">MONITORING ACTIVE</span>
        </div>
      </div>

      {/* Stats row */}
      <LiveStats />

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity over time - wide */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Signal Activity
              <span className="text-xs font-normal text-muted-foreground">(last 60 min)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ActivityTimeline />
            </div>
          </CardContent>
        </Card>

        {/* Protocol breakdown - pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <PieChart className="h-4 w-4 text-purple-400" />
              Protocols
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ProtocolBreakdown />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Classification + RSSI charts + Alerts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-accent" />
                Classification Breakdown
                <span className="text-xs font-normal text-muted-foreground">(last 60 min)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <div className="min-h-44 flex-1">
                <ClassificationTimeline />
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
                  <span className="text-muted-foreground">Known</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground" />
                  <span className="text-muted-foreground">Pending</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />
                  <span className="text-muted-foreground">Unknown</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Signal className="h-4 w-4 text-cyan-400" />
                Signal Strength Distribution
                <span className="text-xs font-normal text-muted-foreground">(dBm)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <div className="min-h-44 flex-1">
                <RSSIDistribution />
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
                  <span className="text-muted-foreground">Strong</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-500" />
                  <span className="text-muted-foreground">Fair</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />
                  <span className="text-muted-foreground">Weak</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive" />
                  <span className="text-muted-foreground">Poor</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Signal className="h-4 w-4 text-primary" />
                SNR Quality Distribution
                <span className="text-xs font-normal text-muted-foreground">(dB)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <div className="min-h-44 flex-1">
                <SNRDistribution />
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
                  <span className="text-muted-foreground">Excellent</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
                  <span className="text-muted-foreground">Good</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />
                  <span className="text-muted-foreground">Fair</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive" />
                  <span className="text-muted-foreground">Poor</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Recent Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsFeed limit={5} />
          </CardContent>
        </Card>
      </div>

      {/* Noise floor timeline - full width */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Waves className="h-4 w-4 text-purple-400" />
            Noise Floor
            <span className="text-xs font-normal text-muted-foreground">(dBm, last 60 min)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <NoiseFloorTimeline />
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-500" />
              <span className="text-muted-foreground">Avg Noise</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded-sm bg-purple-500 opacity-50" style={{ borderTop: "1px dashed" }} />
              <span className="text-muted-foreground">Min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-500/20" />
              <span className="text-muted-foreground">Range</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signal feed - full width */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="h-4 w-4 text-primary" />
            Live Signal Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ObservationsFeed compact />
        </CardContent>
      </Card>
    </div>
  );
}
