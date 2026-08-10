"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Github } from "lucide-react";
import { ForgeWordmark } from "./marks";
import { ThemeToggle } from "./theme";
import { Button } from "./ui";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/demo", label: "Demo" },
  { href: "/minions", label: "Minions" },
  { href: "/#how", label: "How it works" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5" aria-label="Primary">
        <Link href="/" className="text-ink" aria-label="Agent Forge home">
          <ForgeWordmark />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="https://github.com/salehaiftikharr/agent-forge"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:inline-flex"
          >
            <Github size={16} />
          </Link>
          <ThemeToggle />
          <Button href="/forge" size="sm" className="hidden sm:inline-flex">
            Open Forge
          </Button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      <div className={cn("border-t border-line md:hidden", open ? "block" : "hidden")}>
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-surface-2">
              {l.label}
            </Link>
          ))}
          <Button href="/forge" className="mt-1 w-full">
            Open Forge
          </Button>
        </div>
      </div>
    </header>
  );
}
