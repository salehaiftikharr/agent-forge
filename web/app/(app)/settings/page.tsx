import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-muted">This build ships a demo experience. The items below reflect what is and is not wired up.</p>

      <Card className="mt-6 divide-y divide-line">
        <Row title="Theme" desc="Light, dark, or follow your system.">
          <ThemeToggle />
        </Row>
        <Row title="Authentication" desc="Not implemented in this build. Every surface is public and read-mostly.">
          <span className="text-sm text-muted">Not configured</span>
        </Row>
        <Row title="Model provider" desc="The engine uses the Claude API via the CLI. The web app does not call a model directly in this build.">
          <span className="text-sm text-muted">Engine-side</span>
        </Row>
        <Row title="Data" desc="Public surfaces use a fictional dataset. The evaluation numbers are read from the engine's recorded output.">
          <span className="text-sm text-muted">Demo + engine eval</span>
        </Row>
      </Card>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div>
        <div className="font-medium text-ink">{title}</div>
        <div className="text-sm text-muted">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
