"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Hammer, Bot, PlayCircle, Activity, Settings, Menu, X, ArrowLeft, FlaskConical } from "lucide-react";
import { ForgeWordmark } from "./marks";
import { ThemeToggle } from "./theme";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/forge", label: "Forge", icon: Hammer },
  { href: "/minions", label: "Minions", icon: Bot },
  { href: "/runs", label: "Runs", icon: PlayCircle },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Application">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
            )}
          >
            <Icon size={17} className={active ? "text-accent-text" : ""} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar: fixed, scrolls independently of the page. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Link href="/" className="text-ink" aria-label="Agent Forge home">
            <ForgeWordmark markSize={24} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavItems pathname={pathname} />
        </div>
        <div className="border-t border-line p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs" style={{ color: "var(--forge-waiting)" }}>
            <FlaskConical size={13} /> Demo mode · session-local
          </div>
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
              <ArrowLeft size={13} /> Back to site
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted"
          >
            <Menu size={18} />
          </button>
          <Link href="/" className="text-ink"><ForgeWordmark markSize={22} /></Link>
          <ThemeToggle />
        </div>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-line bg-surface">
              <div className="flex h-14 items-center justify-between border-b border-line px-4">
                <ForgeWordmark markSize={22} />
                <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavItems pathname={pathname} onNavigate={() => setOpen(false)} />
              </div>
              <div className="border-t border-line p-3 text-xs" style={{ color: "var(--forge-waiting)" }}>
                <span className="inline-flex items-center gap-2"><FlaskConical size={13} /> Demo mode · session-local</span>
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
