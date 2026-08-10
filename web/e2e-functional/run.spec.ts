import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The functional application, proven in a browser against the real engine
 * (deterministic provider). These assert the actual lifecycle a user drives —
 * not fixtures — and that it survives a reload.
 */

test("runs page renders with a way to start a GitHub task", async ({ page }) => {
  // Order-independent: other specs may have created runs already, so assert the
  // page and its primary call-to-action rather than a strictly-empty list.
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(page.getByRole("link", { name: /New GitHub task/ })).toBeVisible();
});

test("create a run, stream it live, approve, and ship a persisted artifact", async ({ page }) => {
  await page.goto("/work/new");
  await page.waitForLoadState("networkidle"); // let the client form hydrate
  await page.getByRole("button", { name: "Start run" }).click();
  await page.waitForURL(/\/work\/run-/, { timeout: 15_000 });

  // The approval gate appears only after the engine has verified the fix, and
  // nothing ships before a decision.
  await expect(page.getByRole("heading", { name: "Approval required" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("export function clamp")).toBeVisible();
  await expect(page.getByText("Tests passing", { exact: true })).toBeVisible();

  const url = page.url();
  await page.getByRole("button", { name: "Approve & ship" }).click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 30_000 });

  // Persistence: a fresh load from the database still shows the shipped run.
  await page.goto(url);
  await expect(page.getByText("Completed")).toBeVisible();
  await expect(page.getByText("Verified fix — TICKET-002")).toBeVisible();
  await expect(page.getByText("export function clamp")).toBeVisible();
});

test("an impossible ticket is declined, never shipped", async ({ page }) => {
  await page.goto("/work/new");
  await page.waitForLoadState("networkidle");
  await page.getByText("Make add(2, 2) equal 5").click();
  await page.getByRole("button", { name: "Start run" }).click();
  await page.waitForURL(/\/work\/run-/, { timeout: 15_000 });

  await expect(page.getByText(/Declined:/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Approval required" })).toHaveCount(0);
});

for (const path of ["/work", "/work/new", "/work/github"]) {
  test(`no serious or critical accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
  });
}
