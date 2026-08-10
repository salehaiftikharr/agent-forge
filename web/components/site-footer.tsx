import Link from "next/link";
import { ForgeWordmark } from "./marks";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Link href="/" className="text-ink">
            <ForgeWordmark />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted">
            Describe the specialist you need. Forge it. Put it to work. Agent Forge makes small, inspectable Minions and proves what they do.
          </p>
        </div>
        <nav aria-label="Product" className="text-sm">
          <p className="mb-3 font-semibold text-ink">Product</p>
          <ul className="space-y-2 text-muted">
            <li><Link href="/demo" className="hover:text-ink">Demo</Link></li>
            <li><Link href="/forge" className="hover:text-ink">Forge</Link></li>
            <li><Link href="/minions" className="hover:text-ink">Minions</Link></li>
            <li><Link href="/runs" className="hover:text-ink">Runs</Link></li>
          </ul>
        </nav>
        <nav aria-label="More" className="text-sm">
          <p className="mb-3 font-semibold text-ink">More</p>
          <ul className="space-y-2 text-muted">
            <li><Link href="/about" className="hover:text-ink">About</Link></li>
            <li><Link href="https://github.com/salehaiftikharr/agent-forge" target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-4 text-xs text-muted">
          Public examples use a fictional dataset (Northwind). Agent Forge is MIT-licensed.
        </p>
      </div>
    </footer>
  );
}
