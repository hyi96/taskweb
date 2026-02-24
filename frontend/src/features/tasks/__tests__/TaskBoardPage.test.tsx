import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../../../test-utils/render";
import { TaskBoardPage, periodEndForDaily, sortTasks } from "../TaskBoardPage";
import type { Task } from "../../../shared/types/task";

const fetchTasksMock = vi.fn();
const fetchTagsMock = vi.fn();
const habitIncrementMock = vi.fn();
const updateTaskMock = vi.fn();

const setCurrentActivityMock = vi.fn();

vi.mock("../../../features/profiles/ProfileContext", () => ({
  useProfileContext: () => ({ profileId: "11111111-1111-1111-1111-111111111111" })
}));

vi.mock("../../../features/activity/CurrentActivityContext", () => ({
  useCurrentActivity: () => ({ setCurrentActivity: setCurrentActivityMock })
}));

vi.mock("../../../shared/repositories/client", () => ({
  fetchTags: (...args: unknown[]) => fetchTagsMock(...args),
  replaceChecklistItems: vi.fn(),
  replaceStreakRules: vi.fn(),
  fetchTasks: (...args: unknown[]) => fetchTasksMock(...args),
  habitIncrement: (...args: unknown[]) => habitIncrementMock(...args),
  fetchNewDayPreview: vi.fn().mockResolvedValue({ profile_id: "11111111-1111-1111-1111-111111111111", dailies: [] }),
  startNewDay: vi.fn().mockResolvedValue({ updated_count: 0 }),
  dailyComplete: vi.fn(),
  todoComplete: vi.fn(),
  rewardClaim: vi.fn(),
  createTask: vi.fn(),
  updateTask: (...args: unknown[]) => updateTaskMock(...args),
  deleteTask: vi.fn()
}));

vi.mock("../TaskEditorModal", () => ({
  TaskEditorModal: () => null
}));

function makeTask(partial: Partial<Task> & Pick<Task, "id" | "task_type" | "title">): Task {
  const { id, task_type, title, ...rest } = partial;
  return {
    ...rest,
    id,
    profile_id: "11111111-1111-1111-1111-111111111111",
    task_type,
    title,
    notes: "",
    is_hidden: false,
    tag_ids: [],
    gold_delta: "1.00",
    current_count: "0.00",
    count_increment: "1.00",
    count_reset_cadence: null,
    repeat_cadence: null,
    repeat_every: 1,
    current_streak: 0,
    best_streak: 0,
    streak_goal: 0,
    last_completion_period: null,
    autocomplete_time_threshold: null,
    due_at: null,
    is_done: false,
    completed_at: null,
    is_repeatable: false,
    is_claimed: false,
    claimed_at: null,
    claim_count: 0,
    total_actions_count: 0,
    last_action_at: null,
    created_at: "2026-02-20T00:00:00Z",
    updated_at: "2026-02-20T00:00:00Z"
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskBoardPage", () => {
  it("loads tasks for the active profile", async () => {
    fetchTasksMock.mockResolvedValue([makeTask({ id: "t1", task_type: "habit", title: "Drink water" })]);
    fetchTagsMock.mockResolvedValue([]);

    renderWithQueryClient(<TaskBoardPage />);

    expect(await screen.findByText("Drink water")).toBeTruthy();
    expect(fetchTasksMock).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("keeps pending state scoped to only the clicked task row", async () => {
    const tasks = [
      makeTask({ id: "h1", task_type: "habit", title: "Habit 1", count_increment: "1.00" }),
      makeTask({ id: "h2", task_type: "habit", title: "Habit 2", count_increment: "1.00" })
    ];
    fetchTasksMock.mockResolvedValue(tasks);
    fetchTagsMock.mockResolvedValue([]);

    let resolveMutation: ((value: Task) => void) | undefined;
    habitIncrementMock.mockImplementation(
      () =>
        new Promise<Task>((resolve) => {
          resolveMutation = resolve;
        })
    );

    renderWithQueryClient(<TaskBoardPage />);
    await screen.findByText("Habit 1");

    const buttons = screen.getAllByRole("button", { name: "+1" });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(buttons[0].hasAttribute("disabled")).toBe(true));
    expect(buttons[1].hasAttribute("disabled")).toBe(false);

    if (resolveMutation) {
      resolveMutation({ ...tasks[0], current_count: "1.00", total_actions_count: 1 });
    }
    await waitFor(() => expect(buttons[0].hasAttribute("disabled")).toBe(false));
  });

  it("opens/closes quick action menu on outside click and on action click", async () => {
    fetchTasksMock.mockResolvedValue([makeTask({ id: "h1", task_type: "habit", title: "Habit 1" })]);
    fetchTagsMock.mockResolvedValue([]);
    updateTaskMock.mockResolvedValue(makeTask({ id: "h1", task_type: "habit", title: "Habit 1", is_hidden: true }));

    renderWithQueryClient(<TaskBoardPage />);
    await screen.findByText("Habit 1");

    fireEvent.click(screen.getAllByRole("button", { name: "..." })[0]);
    expect(screen.getByRole("button", { name: "Set as current activity" })).toBeTruthy();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Set as current activity" })).toBeNull();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "..." })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Set as current activity" }));

    expect(setCurrentActivityMock).toHaveBeenCalledWith("Habit 1", { taskId: "h1" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Set as current activity" })).toBeNull();
    });
  });
});

describe("task helpers", () => {
  it("sortTasks handles gold and due-date ordering", () => {
    const a = makeTask({ id: "a", task_type: "todo", title: "A", gold_delta: "1.00", due_at: "2026-02-19T00:00:00Z" });
    const b = makeTask({ id: "b", task_type: "todo", title: "B", gold_delta: "5.00", due_at: "2026-02-21T00:00:00Z" });
    const c = makeTask({ id: "c", task_type: "todo", title: "C", gold_delta: "-2.00", due_at: null });

    expect(sortTasks([a, b, c], "Gold value (high to low)").map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(sortTasks([a, b, c], "Due date (earliest to latest)").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("periodEndForDaily uses repeat_every for weekly cadence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));
    const daily = makeTask({
      id: "d1",
      task_type: "daily",
      title: "Weekly",
      repeat_cadence: "week",
      repeat_every: 2,
      created_at: "2026-01-05T00:00:00Z"
    });
    const end = periodEndForDaily(daily);
    expect(end.toISOString().slice(0, 10)).toBe("2026-02-22");
    vi.useRealTimers();
  });
});
