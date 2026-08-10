export function DiffView({ title, body }: { title: string; body: string }) {
  const lines = body.split("\n");
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-surface-2 px-3 py-2 font-mono text-xs text-muted">{title}</div>
      <div className="overflow-x-auto">
        <pre className="min-w-full font-mono text-xs leading-relaxed">
          {lines.map((ln, i) => {
            const add = ln.startsWith("+") && !ln.startsWith("+++");
            const del = ln.startsWith("-") && !ln.startsWith("---");
            const meta = ln.startsWith("@@");
            return (
              <div
                key={i}
                className="px-3"
                style={{
                  background: add ? "color-mix(in srgb, var(--forge-shipped) 12%, transparent)" : del ? "color-mix(in srgb, var(--forge-failed) 12%, transparent)" : undefined,
                  color: add ? "var(--forge-shipped)" : del ? "var(--forge-failed)" : meta ? "var(--forge-muted)" : "var(--forge-ink)",
                }}
              >
                {ln || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
