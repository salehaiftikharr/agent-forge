import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createFakeModel } from "./fake-model";

/**
 * The provider seam — the ONLY place that names a vendor. Forge uses one
 * provider to build agents, run them, and judge them; flip it with --provider
 * or LLM_PROVIDER and nothing else changes. (Same seam pattern as the analytics
 * chat assistant, deliberately.)
 */
export type ProviderName = "anthropic" | "openai";

const DEFAULT_ANTHROPIC_MODEL = "claude-fable-5";
const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export function resolveProvider(value?: string): ProviderName {
  const choice = (value || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (choice === "anthropic" || choice === "openai") return choice;
  throw new Error(
    `Unknown provider "${choice}". Expected "anthropic" or "openai".`,
  );
}

/**
 * Resolve a Vercel AI SDK `LanguageModel` for the chosen provider. Each provider
 * package reads its own key from the environment (ANTHROPIC_API_KEY /
 * OPENAI_API_KEY).
 */
/**
 * The deterministic offline provider (see fake-model.ts). Selected ONLY when the
 * provider is explicitly "fake" — never a silent default — so it cannot be
 * reached by accident in production. Used by the web worker's default local/CI
 * mode and by automated tests to run the real engine without a network or key.
 */
function isFake(override?: string): boolean {
  return (override || process.env.LLM_PROVIDER || "").toLowerCase() === "fake";
}

export function getModel(override?: string): LanguageModel {
  if (isFake(override)) return createFakeModel();
  const provider = resolveProvider(override);
  return provider === "openai"
    ? openai(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
    : anthropic(process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL);
}

export function modelLabel(override?: string): string {
  if (isFake(override)) return "fake/deterministic";
  const provider = resolveProvider(override);
  return provider === "openai"
    ? `openai/${process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL}`
    : `anthropic/${process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}`;
}
