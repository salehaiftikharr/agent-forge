import type { Metadata } from "next";
import { Hammer } from "lucide-react";
import { Button, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Forge" };

export default function ForgePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <div className="flex items-center gap-3 text-ink">
        <Hammer size={22} />
        <h1 className="text-2xl font-bold tracking-tight">Forge workbench</h1>
      </div>
      <p className="mt-3 text-muted">
        The conversational workbench where you describe a job, review a proposed Minion, create it, and watch it work. The full workbench is being built in this branch. The guided demo already walks the whole flow end to end.
      </p>
      <Card className="mt-6 p-5">
        <p className="text-sm text-muted">In the meantime:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button href="/demo">Open the guided demo</Button>
          <Button href="/minions" variant="secondary">See existing Minions</Button>
        </div>
      </Card>
    </div>
  );
}
