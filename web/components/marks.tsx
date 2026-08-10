import { statusToken } from "@/lib/types";
import type { MinionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIE =
  "M9 14 H19 L24 21 L29 14 H39 A4 4 0 0 1 43 18 V39 A4 4 0 0 1 39 43 H9 A4 4 0 0 1 5 39 V18 A4 4 0 0 1 9 14 Z";

/** The Forge mark: a shaping die with a struck V-notch, a billet inside, and an
    ember landing in the notch. Stroke takes currentColor; the ember stays ember. */
export function ForgeMark({ size = 32, className }: { size?: number; className?: string }) {
  const sw = size <= 20 ? 4.5 : 3.5;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Forge" className={className}>
      <path d={DIE} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      {size > 20 && <rect x="15" y="31" width="18" height="5" rx="2.5" fill="currentColor" />}
      <circle cx="24" cy={size > 20 ? 10 : 9} r={size > 20 ? 4 : 6} fill="var(--forge-accent)" />
    </svg>
  );
}

/** The self-forging mark: the die draws, the ember strikes. CSS-driven so it
    respects prefers-reduced-motion (the draw simply completes instantly). */
export function ForgeMarkAnimated({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Forge, forging itself" className={className}>
      <path
        d={DIE}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinejoin="round"
        style={{
          strokeDasharray: 150,
          strokeDashoffset: 150,
          animation: "forge-draw 1.1s var(--forge-ease, cubic-bezier(0.4,0,0.2,1)) 0.1s forwards",
        }}
      />
      <rect x="15" y="31" width="18" height="5" rx="2.5" fill="currentColor" style={{ opacity: 0, animation: "ember-pop 0.4s ease 1s forwards" }} />
      <circle cx="24" cy="10" r="4" fill="var(--forge-accent)" style={{ transformOrigin: "24px 10px", transform: "scale(0)", animation: "ember-pop 0.5s ease 1.35s forwards" }} />
    </svg>
  );
}

export function ForgeWordmark({ className, markSize = 26 }: { className?: string; markSize?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <ForgeMark size={markSize} />
      <span className="text-[1.15em] font-extrabold">Forge</span>
    </span>
  );
}

/** A Minion is the same die, smaller, with a status dot at the shoulder. The dot
    color encodes status; the accompanying label/shape carries it without color. */
export function MinionMark({
  size = 32,
  status = "ready",
  className,
}: {
  size?: number;
  status?: MinionStatus;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={`Minion (${status})`} className={className}>
      <path
        d="M13 17 H21 L24 22 L27 17 H35 A3 3 0 0 1 38 20 V35 A3 3 0 0 1 35 38 H13 A3 3 0 0 1 10 35 V20 A3 3 0 0 1 13 17 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <circle cx="35" cy="15" r="5" fill={statusToken(status)} stroke="var(--forge-surface)" strokeWidth="2.5" />
    </svg>
  );
}
