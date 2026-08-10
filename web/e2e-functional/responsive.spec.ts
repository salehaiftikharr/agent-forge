import { test, expect } from "@playwright/test";

/**
 * The rendered app must never scroll sideways, at desktop, tablet, or phone
 * widths. Covers the viewport range in the directive on the two entry screens
 * (a run detail needs a created run and is covered by run.spec.ts).
 */
const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
  { w: 360, h: 640 },
];

for (const { w, h } of VIEWPORTS) {
  for (const path of ["/work", "/work/new"]) {
    test(`no horizontal overflow at ${w}x${h}: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
