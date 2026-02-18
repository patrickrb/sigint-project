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
  userId: string;
  createdAt?: string;
}

export default function SendersPage() {
  const { data: session } = useSession();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
  const [revealLoading, setRevealLoading] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});

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
    await fetch(`${apiUrl}/api/senders/${id}/revoke`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchSenders();
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Permanently delete this sender and all its observations/alerts?")) return;
    await fetch(`${apiUrl}/api/senders/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setRevealedTokens((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    fetchSenders();
  }

  async function handleReveal(id: string) {
    if (!token) return;
    setRevealLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${apiUrl}/api/senders/${id}/token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedTokens((prev) => ({ ...prev, [id]: data.token }));
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Failed to reveal token");
      }
    } catch {
      alert("Failed to reveal token");
    }
    setRevealLoading((prev) => ({ ...prev, [id]: false }));
  }

  async function handleCopy(id: string, tokenValue: string) {
    await navigator.clipboard.writeText(tokenValue);
    setCopied((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopied((prev) => ({ ...prev, [id]: false }));
    }, 2000);
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
              <p className="text-sm font-medium text-warning">Save this token — you can also reveal it later from the table below:</p>
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
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        {s.status === "ACTIVE" && (
                          <>
                            {revealedTokens[s.id] ? (
                              <button
                                onClick={() =>
                                  setRevealedTokens((prev) => {
                                    const next = { ...prev };
                                    delete next[s.id];
                                    return next;
                                  })
                                }
                                className="text-sm text-muted-foreground hover:underline"
                              >
                                Hide Token
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReveal(s.id)}
                                disabled={revealLoading[s.id]}
                                className="text-sm text-primary hover:underline disabled:opacity-50"
                              >
                                {revealLoading[s.id] ? "Revealing..." : "Reveal Token"}
                              </button>
                            )}
                            <span className="text-border">|</span>
                            <button
                              onClick={() => handleRevoke(s.id)}
                              className="text-sm text-destructive hover:underline"
                            >
                              Revoke
                            </button>
                          </>
                        )}
                        {s.status === "REVOKED" && (
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Delete
                          </button>
                        )}
                      </div>
                      {revealedTokens[s.id] && (
                        <div className="flex items-center gap-2">
                          <code className="break-all rounded bg-muted px-2 py-1 text-xs">
                            {revealedTokens[s.id]}
                          </code>
                          <button
                            onClick={() => handleCopy(s.id, revealedTokens[s.id])}
                            className="shrink-0 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                          >
                            {copied[s.id] ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      )}
                    </div>
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
