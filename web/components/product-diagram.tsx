import { ForgeMark, MinionMark } from "./marks";
import { User, GitPullRequest, PlayCircle, ArrowRight } from "lucide-react";

const NODES = [
  { key: "you", label: "You", sub: "describe a job", icon: <User size={22} /> },
  { key: "forge", label: "Forge", sub: "proposes a Minion", icon: <ForgeMark size={26} /> },
  { key: "minion", label: "Minion", sub: "a scoped specialist", icon: <MinionMark size={26} status="ready" /> },
  { key: "run", label: "Run", sub: "durable, inspectable", icon: <PlayCircle size={22} /> },
  { key: "result", label: "Result", sub: "verified, or declined", icon: <GitPullRequest size={22} /> },
];

export function ProductDiagram() {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0">
      {NODES.map((n, i) => (
        <div key={n.key} className="flex flex-col items-center gap-2 md:flex-row md:gap-0">
          <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 md:w-36 md:flex-col md:gap-2 md:px-3 md:py-4 md:text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-ink">{n.icon}</span>
            <div className="md:mt-1">
              <div className="font-semibold leading-tight text-ink">{n.label}</div>
              <div className="text-xs text-muted">{n.sub}</div>
            </div>
          </div>
          {i < NODES.length - 1 && (
            <span aria-hidden className="mx-1 my-1 rotate-90 text-muted md:my-0 md:rotate-0" style={{ color: n.key === "run" ? "var(--forge-accent)" : undefined }}>
              <ArrowRight size={18} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
