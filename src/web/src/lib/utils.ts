import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleString();
}

export function formatFrequency(hz: number | null | undefined) {
  if (!hz) return "—";
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

export function truncateSignature(sig: string, len = 12) {
  return sig.length > len ? `${sig.slice(0, len)}...` : sig;
}

/** Convert RSSI dBm to 0-5 signal level */
export function rssiToLevel(rssi: number | null | undefined): number {
  if (rssi == null) return 0;
  if (rssi >= -30) return 5;
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

/** Human-readable time ago string */
export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Color class for protocol badges */
export function protocolColor(protocol: string): string {
  const colors: Record<string, string> = {
    "Acurite-Tower": "bg-blue-500/15 text-blue-400 border-blue-500/25",
    "Oregon-THR128": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    "Nexus-TH": "bg-violet-500/15 text-violet-400 border-violet-500/25",
    "LaCrosse-TX": "bg-amber-500/15 text-amber-400 border-amber-500/25",
    "Ambient-Weather": "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
    "ble-adv": "bg-blue-500/15 text-blue-400 border-blue-500/25",
    "ble-energy": "bg-sky-500/15 text-sky-400 border-sky-500/25",
    "spectrum-anomaly": "bg-rose-500/15 text-rose-400 border-rose-500/25",
    "spectrum-baseline": "bg-purple-500/15 text-purple-400 border-purple-500/25",
  };
  return colors[protocol] || "bg-primary/10 text-primary border-primary/20";
}
