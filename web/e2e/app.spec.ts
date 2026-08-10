import { test, expect, type Page } from "@playwright/test";

const PUBLIC_ROUTES = ["/", "/demo", "/about", "/minions", "/runs"];

test.describe("landing", () => {
  test("communicates the product and shows engine-backed eval numbers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Describe the");
    await expect(page.getByText("From the engine")).toBeVisible();
    await expect(page.getByText("Unsafe ships")).toBeVisible();
    // The engine records zero unsafe ships; the stat must render it.
    const strip = page.locator("text=Unsafe ships").locator("xpath=..");
    await expect(strip).toContainText("0");
    await expect(page.getByText("Good fixes shipped")).toBeVisible();
  });

  test("landing → demo → forge navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Try the demo/i }).first().click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole("heading", { name: /Forge a Minion/i })).toBeVisible();
    await page.goto("/forge");
    await expect(page.getByRole("heading", { name: "Forge", exact: true })).toBeVisible();
  });
});

async function driveDemoToApproval(page: Page) {
  await page.goto("/demo");
  // Let the client component hydrate before driving its buttons.
  await expect(page.getByRole("button", { name: /Ask Forge/i })).toBeEnabled();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Ask Forge/i }).click();
  await page.getByRole("button", { name: /Forge proposes a Minion/i }).click();
  await page.getByRole("button", { name: /Review its tools/i }).click();
  await page.getByRole("button", { name: /Create this Minion/i }).click();
  await page.getByRole("button", { name: /Start the run/i }).click();
  await page.getByRole("button", { name: /^Next step/i }).click();
  await page.getByRole("button", { name: /^Next step/i }).click();
  await page.getByRole("button", { name: /^Next step/i }).click();
}

test.describe("demo golden path", () => {
  test("the approval gate blocks progression until a decision", async ({ page }) => {
    await driveDemoToApproval(page);
    // At the gate: Approve/Reject exist, and there is NO way to advance the run.
    await expect(page.getByRole("button", { name: /^Approve/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reject/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Next step/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Continue the run/i })).toHaveCount(0);
    await expect(page.getByText(/paused at the approval gate/i)).toBeVisible();
  });

  test("approve → tool activity, honest failure, recovery, shipped diff, roster", async ({ page }) => {
    await driveDemoToApproval(page);
    await page.getByRole("button", { name: /^Approve/ }).click();
    // Reveal the tail step by step.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /Continue the run/i }).click();
    }
    await expect(page.getByText("You approved the write")).toBeVisible();
    await expect(page.getByText(/Step failed: sandbox timeout/i)).toBeVisible();
    await expect(page.getByText(/Retrying from the last checkpoint/i)).toBeVisible();
    await expect(page.getByText(/Verification gate: 8\/8 passing/i)).toBeVisible();
    await expect(page.getByText("Shipped").first()).toBeVisible();
    await expect(page.getByText(/is now in your roster/i)).toBeVisible();
    // The diff artifact is shown.
    await expect(page.getByText("export function clamp").first()).toBeVisible();
  });

  test("reject → the run is declined honestly", async ({ page }) => {
    await driveDemoToApproval(page);
    await page.getByRole("button", { name: /^Reject/ }).click();
    await expect(page.getByText("You rejected the write")).toBeVisible();
    await expect(page.getByText("Declined").first()).toBeVisible();
    await expect(page.getByText(/reported the limitation honestly/i)).toBeVisible();
  });
});

test.describe("minions", () => {
  test("roster shows operational minions and filters", async ({ page }) => {
    await page.goto("/minions");
    await expect(page.getByRole("heading", { name: "Minions", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repo Triage" })).toBeVisible();
    await page.getByRole("searchbox", { name: /Search Minions/i }).fill("release");
    await expect(page.getByRole("heading", { name: "Release Notes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repo Triage" })).toHaveCount(0);
  });

  test("detail shows tools, permissions, and runs", async ({ page }) => {
    await page.goto("/minions/m-repo-triage");
    await expect(page.getByRole("heading", { name: "Repo Triage" })).toBeVisible();
    await expect(page.getByText("write_patch").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data access", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /NWT-214/i })).toBeVisible();
  });
});

test.describe("runs", () => {
  test("detail shows the verification gate, timeline, and diff", async ({ page }) => {
    await page.goto("/runs/r-recover");
    await expect(page.getByRole("heading", { name: "Verification gate" })).toBeVisible();
    await expect(page.getByText(/8\/8 passing/).first()).toBeVisible();
    await expect(page.getByText(/Retrying from the last checkpoint/i)).toBeVisible();
    // r-recover's artifact is the slugify diff; assert the diff file rendered.
    await expect(page.getByText("src/utils.js").first()).toBeVisible();
  });

  test("a waiting run offers approve/reject; a failed run offers retry/cancel", async ({ page }) => {
    await page.goto("/runs/r-waiting");
    await expect(page.getByText(/waiting for your approval/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible();
  });
});

test.describe("responsive + navigation", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`no horizontal overflow at 390px: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("mobile app drawer opens and closes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/minions");
    await page.getByRole("button", { name: /Open navigation/i }).click();
    await expect(page.getByRole("dialog", { name: /Navigation/i })).toBeVisible();
    await page.getByRole("button", { name: /Close navigation/i }).click();
    await expect(page.getByRole("dialog", { name: /Navigation/i })).toHaveCount(0);
  });

  test("keyboard: the primary hero CTA is reachable and activates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Try the demo/i }).first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/demo$/);
  });
});

test.describe("privacy", () => {
  const DENYLIST = [
    "salehaiftikharrrr@gmail",
    "718",
    "Gettysburg",
    "SuperOrgs",
    "H-1B",
    "OPT",
    "visa",
    "job search",
    "forge-minions-demo",
  ];
  for (const route of [...PUBLIC_ROUTES, "/minions/m-repo-triage", "/runs/r-recover"]) {
    test(`no private/denylist terms on ${route}`, async ({ page }) => {
      await page.goto(route);
      const text = await page.locator("body").innerText();
      for (const term of DENYLIST) {
        // Word-boundary match so short terms (opt, visa) do not flag words like
        // "optional" or "advisable".
        const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`, "i");
        expect(re.test(text), `"${term}" must not appear on a public page`).toBe(false);
      }
    });
  }
});

test.describe("console health", () => {
  test("no console errors on the landing page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    await page.goto("/");
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });
});
