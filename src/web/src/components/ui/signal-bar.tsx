import { cn } from "@/lib/utils";

const barColors = [
  "bg-destructive",     // level 0 - no signal
  "bg-destructive",     // level 1 - very weak
  "bg-warning",         // level 2 - weak
  "bg-warning",         // level 3 - fair
  "bg-accent",          // level 4 - good
  "bg-accent",          // level 5 - excellent
];

export function SignalBar({ level, className }: { level: number; className?: string }) {
  return (
    <div className={cn("flex items-end gap-0.5", className)} title={`Signal: ${level}/5`}>
      {[1, 2, 3, 4, 5].map((bar) => (
        <div
          key={bar}
          className={cn(
            "w-1 rounded-sm transition-all",
            bar <= level ? barColors[level] : "bg-border/50"
          )}
          style={{ height: `${4 + bar * 3}px` }}
        />
      ))}
    </div>
  );
}
