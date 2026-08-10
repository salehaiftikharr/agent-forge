import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Agent Forge — describe the specialist you need, forge it, put it to work",
    template: "%s · Agent Forge",
  },
  description:
    "Agent Forge turns plain English into inspectable specialist agents — Minions — with explicit tools, permissions, durable runs, approval gates, and results it can prove. Its minions open a pull request only when a test proves the fix.",
  applicationName: "Agent Forge",
  keywords: ["ai agents", "agent engineering", "verification gate", "llm evals", "claude", "developer tools"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
