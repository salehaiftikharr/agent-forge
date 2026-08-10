import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = [
  "/",
  "/demo",
  "/about",
  "/minions",
  "/minions/m-repo-triage",
  "/runs",
  "/runs/r-recover",
  "/forge",
  "/settings",
  "/activity",
];

for (const route of ROUTES) {
  test(`accessibility (no serious/critical violations): ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      serious,
      JSON.stringify(serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), null, 2)
    ).toEqual([]);
  });
}
