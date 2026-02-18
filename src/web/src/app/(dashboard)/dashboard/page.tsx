import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveStats } from "@/components/live-stats";
import { ObservationsFeed } from "@/components/observations-feed";
import { AlertsFeed } from "@/components/alerts-feed";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Real-time RF telemetry overview</p>
      </div>

      <LiveStats />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ObservationsFeed />
        </div>
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Recent Alerts</CardTitle>
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
