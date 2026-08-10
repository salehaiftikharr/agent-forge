import { Card, Button } from "@/components/ui";
import { ForgeWordmark } from "@/components/marks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm p-7">
        <ForgeWordmark markSize={26} />
        <h1 className="mt-4 text-xl font-bold tracking-tight text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-muted">
          Enter the workspace passphrase to open the Agent Forge workbench.
        </p>
        <form method="POST" action="/api/sign-in" className="mt-5 space-y-3">
          <input type="hidden" name="next" value={next ?? "/work"} />
          <input
            type="password"
            name="passphrase"
            autoFocus
            required
            aria-label="Workspace passphrase"
            placeholder="Passphrase"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[var(--forge-accent-strong)]"
          />
          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--forge-failed-ink)" }}>
              That passphrase is not correct.
            </p>
          )}
          <Button type="submit" className="w-full">
            Enter
          </Button>
        </form>
      </Card>
    </div>
  );
}
