import { expect, test } from "@playwright/test";
import { createProfileViaUi, goToFrontend, loginAsAdmin, loginThroughApp, requireAdminPassword, uniqueName } from "./helpers";

test.describe("Auth and CSRF flows", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await goToFrontend(page, "/tasks");
  });

  test("protected app actions require login until session is restored", async ({ page }) => {
    await loginAsAdmin(page);
    await goToFrontend(page, "/profiles");
    await expect(page.getByRole("button", { name: "Add profile" })).toBeVisible();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add profile" })).toHaveCount(0);

    await goToFrontend(page, "/profiles");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await loginThroughApp(page);
    await goToFrontend(page, "/profiles");
    await expect(page.getByRole("button", { name: "Add profile" })).toBeVisible();
  });

  test("same-origin CSRF allows login and authenticated writes", async ({ page }) => {
    await loginThroughApp(page);

    const profileName = uniqueName("e2e-csrf-profile");
    await goToFrontend(page, "/profiles");
    await page.getByPlaceholder("New profile name").fill(profileName);
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes("/api/profiles/") && resp.request().method() === "POST"),
      page.getByRole("button", { name: "Add profile" }).click()
    ]);

    expect(response.status()).toBe(201);
    const payload = (await response.json()) as { id: string; name: string; gold_balance: string };
    expect(payload.id).toBeTruthy();
    expect(payload.name).toBe(profileName);
    expect(payload.gold_balance).toBe("0.00");

    await expect(page.locator("li.profile-row strong", { hasText: profileName })).toBeVisible();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await loginThroughApp(page);
    await createProfileViaUi(page, uniqueName("e2e-csrf-after-logout"));
  });
});
