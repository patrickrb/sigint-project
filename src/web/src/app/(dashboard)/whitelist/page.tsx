"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, truncateSignature } from "@/lib/utils";

interface WhitelistEntry {
  id: string;
  signature: string;
  label: string;
  protocol: string | null;
  notes: string | null;
  createdAt: string;
}

export default function WhitelistPage() {
  const { data: session } = useSession();
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [signature, setSignature] = useState("");
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  async function fetchEntries() {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/whitelist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || data);
      }
    } catch {}
  }

  useEffect(() => {
    fetchEntries();
  }, [session]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!signature.trim() || !label.trim() || !token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/whitelist`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          signature,
          label,
          protocol: protocol || undefined,
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        setSignature("");
        setLabel("");
        setProtocol("");
        setNotes("");
        fetchEntries();
      }
    } catch {}
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Remove this whitelist entry?")) return;
    await fetch(`${apiUrl}/api/whitelist/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchEntries();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Whitelist</h1>
        <p className="text-sm text-muted-foreground">Manage known device signatures</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Device signature (SHA-256)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g., Kitchen Thermometer)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <input
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                placeholder="Protocol (optional)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add to Whitelist
            </button>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Label</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Signature</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Protocol</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Added</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No whitelist entries yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-medium">{e.label}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-muted-foreground">{truncateSignature(e.signature, 20)}</code>
                  </td>
                  <td className="px-4 py-3">{e.protocol || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-sm text-destructive hover:underline"
                    >
                      Remove
                    </button>
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
