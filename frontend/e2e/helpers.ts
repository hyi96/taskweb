import { expect, type Locator, type Page, test } from "@playwright/test";

const BACKEND_BASE_URL = process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:8000";
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

export function requireAdminPassword() {
  test.skip(!ADMIN_PASSWORD, "Set E2E_ADMIN_PASSWORD to run authenticated E2E tests.");
}

export async function loginAsAdmin(page: Page) {
  await page.goto(`${BACKEND_BASE_URL}/admin/login/?next=/admin/`);

  const usernameInput = page.locator("#id_username");
  if ((await usernameInput.count()) > 0) {
    await usernameInput.fill(ADMIN_USERNAME);
    await page.locator("#id_password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /log in/i }).click();
  }

  await expect(page).not.toHaveURL(/\/admin\/login\//);
  await expect(page.locator("body")).toContainText("Site administration");
}

export async function goToFrontend(page: Page, path = "/tasks") {
  await page.goto(path);
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export async function createProfileViaUi(page: Page, name: string): Promise<{ id: string; name: string }> {
  await goToFrontend(page, "/profiles");
  await page.getByPlaceholder("New profile name").fill(name);
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/profiles/") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Add profile" }).click()
  ]);
  expect(response.ok(), `Profile creation failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const created = (await response.json()) as { id: string; name: string };
  await page.evaluate((id) => window.localStorage.setItem("taskweb.profile_id", id), created.id);
  return created;
}

export async function ensureProfileSelected(page: Page, profileName: string, profileId?: string) {
  const selector = page.locator("#profile-id");
  await expect(selector).toBeVisible();
  if (profileId) {
    await page.evaluate((id) => window.localStorage.setItem("taskweb.profile_id", id), profileId);
    await selector.selectOption({ value: profileId });
    await expect(selector).toHaveValue(profileId);
    await expect
      .poll(async () => await page.evaluate(() => window.localStorage.getItem("taskweb.profile_id")))
      .toBe(profileId);
    return;
  }

  await selector.selectOption({ label: profileName });
  await expect(selector.locator("option:checked")).toContainText(profileName);
}

export async function quickAddTask(page: Page, placeholder: string, title: string) {
  const input = page.getByPlaceholder(placeholder);
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByText(title)).toBeVisible();
}

export function taskCard(page: Page, title: string): Locator {
  return page.locator("li.clickable-card", {
    has: page.locator("strong", { hasText: title })
  });
}
