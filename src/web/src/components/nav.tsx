"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Radio,
  Shield,
  AlertTriangle,
  Activity,
  Radar,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/senders", label: "Senders", icon: Radio },
  { href: "/whitelist", label: "Whitelist", icon: Shield },
  { href: "/rules", label: "Rules", icon: Activity },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Radar className="h-5 w-5 text-primary animate-radar" />
            <span>RF Telemetry</span>
          </Link>
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                    pathname === item.href ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            System Active
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
