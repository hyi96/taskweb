import { expect, test } from "@playwright/test";
import {
  createProfileViaUi,
  ensureProfileSelected,
  goToFrontend,
  loginAsAdmin,
  requireAdminPassword,
  uniqueName
} from "./helpers";

test.describe("Current activity flows", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await loginAsAdmin(page);
  });

  test("start/pause logs activity and appears on logs page", async ({ page }) => {
    const profileName = uniqueName("e2e-activity-profile");
    const activityTitle = uniqueName("Deep Work");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);

    await page.getByPlaceholder("Activity title...").fill(activityTitle);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".activity-time")).toHaveText(/00:00:0[1-9]/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Pause" }).click();

    await goToFrontend(page, "/logs");
    await ensureProfileSelected(page, profileName, profile.id);
    await expect(page.getByText(activityTitle)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("activity_duration")).toBeVisible();
  });

  test("running activity is logged on reload", async ({ page }) => {
    const profileName = uniqueName("e2e-reload-profile");
    const activityTitle = uniqueName("Reload Activity");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);

    await page.getByPlaceholder("Activity title...").fill(activityTitle);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".activity-time")).toHaveText(/00:00:0[1-9]/, { timeout: 10_000 });
    await page.reload();
    await ensureProfileSelected(page, profileName, profile.id);

    await goToFrontend(page, "/logs");
    await ensureProfileSelected(page, profileName, profile.id);
    await expect
      .poll(async () => await page.getByText(activityTitle).count(), {
        timeout: 10_000
      })
      .toBeGreaterThan(0);
  });
});
