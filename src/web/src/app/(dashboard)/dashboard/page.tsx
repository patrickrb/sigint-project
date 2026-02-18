import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveStats } from "@/components/live-stats";
import { ObservationsFeed } from "@/components/observations-feed";
import { AlertsFeed } from "@/components/alerts-feed";
import { Activity, AlertTriangle, Radio } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
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

      <LiveStats />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Signal Feed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ObservationsFeed />
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Recent Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AlertsFeed limit={5} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
