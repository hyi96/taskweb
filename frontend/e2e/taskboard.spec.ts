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

test.describe("Task board journeys", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await loginAsAdmin(page);
  });

  test("create/select profile, add all task types, run actions", async ({ page }) => {
    const profileName = uniqueName("e2e-board-profile");
    const habitName = uniqueName("habit");
    const dailyName = uniqueName("daily");
    const todoName = uniqueName("todo");
    const rewardName = uniqueName("reward");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);

    await quickAddTask(page, "Add Habit", habitName);
    await quickAddTask(page, "Add Daily", dailyName);
    await quickAddTask(page, "Add Todo", todoName);
    await quickAddTask(page, "Add Reward", rewardName);

    await taskCard(page, habitName).locator(".action-button").click();
    await expect(taskCard(page, habitName).getByText("Count 1.00")).toBeVisible();

    await taskCard(page, dailyName).locator(".action-button").click();
    await expect(taskCard(page, dailyName).getByRole("button", { name: "Done for the period" })).toBeVisible();

    await taskCard(page, todoName).locator(".action-button").click();
    await expect(taskCard(page, todoName)).toHaveCount(0);
    await page.locator("section.task-column", { hasText: "Todos" }).getByRole("button", { name: "completed" }).click();
    await expect(taskCard(page, todoName).getByRole("button", { name: "Done" })).toBeVisible();

    await taskCard(page, rewardName).locator(".action-button").click();
    await expect(taskCard(page, rewardName).getByRole("button", { name: "Claimed" })).toBeVisible();
  });

  test("quick action menu can set current activity and hide/unhide tasks", async ({ page }) => {
    const profileName = uniqueName("e2e-menu-profile");
    const habitName = uniqueName("menu-habit");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);
    await quickAddTask(page, "Add Habit", habitName);

    const habit = taskCard(page, habitName);
    await habit.locator(".card-menu-trigger").click();
    await page.getByRole("button", { name: "Set as current activity" }).click();
    await expect(page.getByPlaceholder("Activity title...")).toHaveValue(habitName);

    await habit.locator(".card-menu-trigger").click();
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(habit).toHaveCount(0);

    await page.locator("section.task-column", { hasText: "Habits" }).getByRole("button", { name: "hidden" }).click();
    const hiddenHabit = taskCard(page, habitName);
    await expect(hiddenHabit).toBeVisible();

    await hiddenHabit.locator(".card-menu-trigger").click();
    await page.getByRole("button", { name: "Unhide" }).click();
    await expect(hiddenHabit).toHaveCount(0);

    await page.locator("section.task-column", { hasText: "Habits" }).getByRole("button", { name: "all" }).click();
    await expect(taskCard(page, habitName)).toBeVisible();
  });

  test("reward insufficient-funds toast appears", async ({ page }) => {
    const profileName = uniqueName("e2e-funds-profile");
    const rewardName = uniqueName("expensive-reward");

    const profile = await createProfileViaUi(page, profileName);
    await goToFrontend(page, "/tasks");
    await ensureProfileSelected(page, profileName, profile.id);
    await quickAddTask(page, "Add Reward", rewardName);

    await taskCard(page, rewardName).locator(".action-button").click();
    await expect(page.getByText("Insufficient gold to claim this reward.")).toBeVisible();
  });
});
