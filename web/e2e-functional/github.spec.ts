import { test, expect } from "@playwright/test";

/**
 * The GitHub coding flow, driven in a browser against the real engine + worker
 * (deterministic provider and deterministic GitHub adapter). Proves: submit a
 * repo + issue task → verified diff → approval gate → a verified draft PR that
 * persists across a reload. No network, no credentials.
 */
test("github task: compose → approve → verified draft PR, persisted", async ({ page }) => {
  await page.goto("/work/github");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Repository").fill("acme/widgets");
  await page.getByLabel(/Issue number/).fill("42");
  await page.getByLabel(/What should Agent Forge do/).fill("Investigate issue #42 and implement the fix.");
  await page.getByRole("button", { name: "Start task" }).click();
  await page.waitForURL(/\/work\/run-/, { timeout: 15_000 });

  // The repo is shown, and it parks for approval before any external write.
  await expect(page.getByText("acme/widgets").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval required" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("export function clamp")).toBeVisible();
  // The reviewer sees the exact external action and the blast radius.
  await expect(page.getByText(/External action:/)).toBeVisible();
  await expect(page.getByText(/Changed files:/)).toBeVisible();

  const url = page.url();
  await page.getByRole("button", { name: "Approve & ship" }).click();

  // A verified draft PR appears and persists across a reload.
  await expect(page.getByRole("heading", { name: "Draft pull request" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /github\.com\/acme\/widgets\/pull\// })).toBeVisible();

  await page.goto(url);
  await expect(page.getByText("Completed")).toBeVisible();
  await expect(page.getByRole("link", { name: /github\.com\/acme\/widgets\/pull\// })).toBeVisible();
});

test("natural-language intake interprets a sentence and pre-fills the task", async ({ page }) => {
  await page.goto("/work/github");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/Describe it in a sentence/).fill("Fix issue #1 in acme/widgets and open a PR");
  await page.getByRole("button", { name: "Interpret" }).click();

  // Shows what it understood, and fills the structured fields for confirmation.
  await expect(page.getByText(/Understood:/)).toBeVisible();
  await expect(page.getByLabel("Repository")).toHaveValue("acme/widgets");
  await expect(page.getByLabel(/Issue number/)).toHaveValue("1");
});
