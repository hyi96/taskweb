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

test.describe("Graphs page interactions", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await loginAsAdmin(page);
  });

  test("resolution/type/value/instance/search interactions update graph view", async ({ page }) => {
    const profileName = uniqueName("e2e-graphs-profile");
    const habitName = uniqueName("graph-habit");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);
    await quickAddTask(page, "Add Habit", habitName);
    await taskCard(page, habitName).locator(".action-button").click();

    await goToFrontend(page, "/graphs");
    await ensureProfileSelected(page, profileName, profile.id);
    await expect(page.getByRole("heading", { name: "Graphical Insights" })).toBeVisible();
    await expect(page.locator("svg.graph-svg")).toBeVisible();

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByRole("button", { name: "Week" })).toHaveClass(/active/);

    const selects = page.locator(".graph-controls select");
    await selects.nth(0).selectOption("habit");
    await selects.nth(1).selectOption("count_delta");
    await page.getByPlaceholder("Search target instance...").fill(habitName.slice(0, 8));
    await expect(page.locator(".graph-search-results li", { hasText: habitName }).first()).toBeVisible({ timeout: 10_000 });
    await page.locator(".graph-search-results li", { hasText: habitName }).first().click();

    await expect(selects.nth(0)).toHaveValue("habit");
    await expect(page.locator("svg.graph-svg circle")).toHaveCount(8);
  });
});
