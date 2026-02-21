import { expect, test } from "@playwright/test";
import {
  createProfileViaUi,
  ensureProfileSelected,
  goToFrontend,
  loginAsAdmin,
  quickAddTask,
  requireAdminPassword,
  taskCard,
  uniqueName
} from "./helpers";

test.describe("Logs page filters", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await loginAsAdmin(page);
  });

  test("limit and date filters trigger scoped refetches", async ({ page }) => {
    const profileName = uniqueName("e2e-logs-profile");
    const habitName = uniqueName("logs-habit");
    const seenLogUrls: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/api/logs/?")) {
        seenLogUrls.push(request.url());
      }
    });

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);
    await quickAddTask(page, "Add Habit", habitName);
    await taskCard(page, habitName).locator(".action-button").click();

    await goToFrontend(page, "/logs");
    await expect(page.getByRole("heading", { name: "Recent Logs" })).toBeVisible();

    await page.locator(".logs-filters select").selectOption("100");
    await expect(page.locator(".logs-filters select")).toHaveValue("100");

    const dateInputs = page.locator('.logs-filters input[type="date"]');
    await dateInputs.nth(0).fill("2026-02-01");
    await dateInputs.nth(1).fill("2026-02-28");

    await expect
      .poll(() => seenLogUrls.some((url) => url.includes("limit=100")))
      .toBe(true);
    await expect
      .poll(() => seenLogUrls.some((url) => url.includes("from=2026-02-01")))
      .toBe(true);
    await expect
      .poll(() => seenLogUrls.some((url) => url.includes("to=2026-02-28")))
      .toBe(true);
  });
});
