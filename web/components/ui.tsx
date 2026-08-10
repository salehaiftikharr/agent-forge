import Link from "next/link";
import { cn } from "@/lib/utils";
import { statusToken, statusInk, STATUS_LABEL, RUN_STATE_LABEL } from "@/lib/types";
import type { MinionStatus, RunState } from "@/lib/types";
import { FlaskConical, Cpu } from "lucide-react";

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  href?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const btnVariant = {
  primary: "bg-[var(--forge-accent-strong)] text-[var(--forge-on-accent)] hover:brightness-[1.08]",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
};
const btnSize = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };

export function Button({ variant = "primary", size = "md", className, href, children, ...rest }: ButtonProps) {
  const cls = cn(btnBase, btnVariant[variant], btnSize[size], className);
  if (href) {
    const external = href.startsWith("http");
    return (
      <Link href={href} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs font-bold uppercase tracking-[0.14em] text-accent-text", className)}>{children}</p>
  );
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted", className)}>
      {children}
    </span>
  );
}

/** Labels data that comes from deterministic demo fixtures, never live backend. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium", className)} style={{ color: "var(--forge-waiting-ink)" }}>
      <FlaskConical size={12} /> Demo data
    </span>
  );
}

/** Labels data read from the real engine output on disk. */
export function EngineBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium", className)} style={{ color: "var(--forge-shipped-ink)" }}>
      <Cpu size={12} /> From the engine
    </span>
  );
}

/** Status pill: a colored dot (fill) plus an always-present text label in a
    text-safe ink, so status reads without relying on color alone (WCAG 1.4.1)
    and the text meets AA contrast on the surface. */
export function StatusPill({ status, className }: { status: MinionStatus | RunState; className?: string }) {
  const label = (STATUS_LABEL as Record<string, string>)[status] ?? (RUN_STATE_LABEL as Record<string, string>)[status] ?? status;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium", className)}
      style={{ color: statusInk(status) }}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: statusToken(status) }} />
      {label}
    </span>
  );
}

export function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div>
      <div className="text-3xl font-extrabold tracking-tight tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}
