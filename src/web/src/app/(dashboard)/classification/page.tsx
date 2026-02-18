"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

interface ProtocolRule {
  id: string;
  pattern: string;
  classification: "KNOWN" | "UNKNOWN";
  label: string;
  createdAt: string;
}

export default function ClassificationPage() {
  const { data: session } = useSession();
  const [rules, setRules] = useState<ProtocolRule[]>([]);
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");
  const [classification, setClassification] = useState<"KNOWN" | "UNKNOWN">("KNOWN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const token = (session?.user as any)?.apiToken;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  async function fetchRules() {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/protocol-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch {}
  }

  useEffect(() => {
    fetchRules();
  }, [session]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !label.trim() || !token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/protocol-rules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, label, classification }),
      });
      if (res.ok) {
        setPattern("");
        setLabel("");
        setClassification("KNOWN");
        fetchRules();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create rule");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Remove this classification rule?")) return;
    await fetch(`${apiUrl}/api/protocol-rules/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchRules();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Classification Rules</h1>
        <p className="text-sm text-muted-foreground">
          Automatically classify observations by protocol pattern. Matching protocols are classified
          without needing individual whitelist entries.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Rule</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="Pattern (e.g., acurite-*)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g., Weather Stations)"
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value as "KNOWN" | "UNKNOWN")}
                className="rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="KNOWN">KNOWN</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add Rule
            </button>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pattern</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Label</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Classification</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Added</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No classification rules yet.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border/50">
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{rule.pattern}</code>
                  </td>
                  <td className="px-4 py-3 font-medium">{rule.label}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        rule.classification === "KNOWN"
                          ? "inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400"
                          : "inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400"
                      }
                    >
                      {rule.classification}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(rule.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(rule.id)}
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
