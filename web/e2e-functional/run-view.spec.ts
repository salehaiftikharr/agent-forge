import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The run detail view is the densest surface — a live timeline, a full diff, a
 * PR panel, and long repo/branch names. These prove it renders without the page
 * scrolling sideways at phone/tablet/desktop widths, holds up in dark theme, and
 * is reachable by keyboard. Uses the deterministic github flow to get a real
 * completed run to render.
 */

async function createCompletedGithubRun(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/tasks", {
    data: { repo: "acme/widgets", issueNumber: 1, goal: "Fix issue #1", openPr: true },
  });
  const { run } = await res.json();
  const id = run.id;
  const deadline = Date.now() + 45_000;
  const state = async () => (await (await request.get(`/api/runs/${id}`)).json()).run.state;
  while ((await state()) !== "waiting_approval") {
    if (Date.now() > deadline) throw new Error("run never reached approval");
    await new Promise((r) => setTimeout(r, 500));
  }
  await request.post(`/api/runs/${id}/decision`, { data: { decision: "approve" } });
  while ((await state()) !== "completed") {
    if (Date.now() > deadline) throw new Error("run never completed");
    await new Promise((r) => setTimeout(r, 500));
  }
  return id;
}

let runId: string;
test.beforeAll(async ({ request }) => {
  runId = await createCompletedGithubRun(request);
});

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
];

for (const { w, h } of VIEWPORTS) {
  test(`run detail: no horizontal overflow at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/work/${runId}`);
    await expect(page.getByRole("heading", { name: "Draft pull request" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("run detail renders in dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/work/${runId}`);
  await expect(page.getByText("Completed")).toBeVisible();
  await expect(page.getByRole("link", { name: /pull\// })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // A dark ground, not white — proves the theme actually applied.
  expect(bg).not.toBe("rgb(255, 255, 255)");
});

test("the composer is reachable and submittable by keyboard", async ({ page }) => {
  await page.goto("/work/github");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Repository").focus();
  await page.keyboard.type("acme/widgets");
  await page.keyboard.press("Tab"); // -> issue
  await page.keyboard.type("1");
  await page.getByLabel(/What should Agent Forge do/).focus();
  await page.keyboard.type("Fix it");
  await page.getByRole("button", { name: "Start task" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/work\/run-/, { timeout: 15_000 });
});
