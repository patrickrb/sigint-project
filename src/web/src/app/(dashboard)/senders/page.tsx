"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Sender {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  createdAt?: string;
}

export default function SendersPage() {
  const { data: session } = useSession();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  async function fetchSenders() {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/senders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSenders(data.senders || data);
      }
    } catch {}
  }

  useEffect(() => {
    fetchSenders();
  }, [session]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !token) return;
    setLoading(true);
    setNewToken(null);
    try {
      const res = await fetch(`${apiUrl}/api/senders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewToken(data.token);
        setName("");
        fetchSenders();
      }
    } catch {}
    setLoading(false);
  }

  async function handleRevoke(id: string) {
    if (!token || !confirm("Revoke this sender?")) return;
    await fetch(`${apiUrl}/api/senders/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchSenders();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Senders</h1>
        <p className="text-sm text-muted-foreground">Manage radio sender devices</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Sender</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sender name"
              className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
          </form>
          {newToken && (
            <div className="mt-4 rounded-md border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm font-medium text-warning">Save this token — it won't be shown again:</p>
              <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{newToken}</code>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Seen</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {senders.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No senders created yet.
                </td>
              </tr>
            ) : (
              senders.map((s) => (
                <tr key={s.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={s.status === "ACTIVE" ? "success" : "destructive"}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.lastSeenAt ? formatDate(s.lastSeenAt) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    {s.status === "ACTIVE" && (
                      <button
                        onClick={() => handleRevoke(s.id)}
                        className="text-sm text-destructive hover:underline"
                      >
                        Revoke
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
