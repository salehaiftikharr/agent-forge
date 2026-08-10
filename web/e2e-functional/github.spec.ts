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

  const url = page.url();
  await page.getByRole("button", { name: "Approve & ship" }).click();

  // A verified draft PR appears and persists across a reload.
  await expect(page.getByRole("heading", { name: "Draft pull request" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /github\.com\/acme\/widgets\/pull\// })).toBeVisible();

  await page.goto(url);
  await expect(page.getByText("Completed")).toBeVisible();
  await expect(page.getByRole("link", { name: /github\.com\/acme\/widgets\/pull\// })).toBeVisible();
});
