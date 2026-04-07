import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../../../test-utils/render";
import { TaskBoardPage, isDailyCompletedForCurrentPeriod, periodEndForDaily, sortTasks } from "../TaskBoardPage";
import type { Task } from "../../../shared/types/task";

const fetchTasksMock = vi.fn();
const fetchTagsMock = vi.fn();
const fetchNewDayPreviewMock = vi.fn();
const startNewDayMock = vi.fn();
const habitIncrementMock = vi.fn();
const updateTaskMock = vi.fn();
const activeProfileGoldMock = { value: "10.00" };

const setCurrentActivityMock = vi.fn();

vi.mock("../../../features/profiles/ProfileContext", () => ({
  useProfileContext: () => ({
    profileId: "11111111-1111-1111-1111-111111111111",
    activeProfile: { id: "11111111-1111-1111-1111-111111111111", gold_balance: activeProfileGoldMock.value }
  })
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
  fetchNewDayPreview: (...args: unknown[]) => fetchNewDayPreviewMock(...args),
  startNewDay: (...args: unknown[]) => startNewDayMock(...args),
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
    profile_id: "11111111-1111-1111-1111-111111111111",
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
    streak_protection_cost: "1.00",
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
    updated_at: "2026-02-20T00:00:00Z",
    id,
    task_type,
    title,
    ...rest
  };
}

async function flushScheduledUiWork() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  activeProfileGoldMock.value = "10.00";
  fetchNewDayPreviewMock.mockResolvedValue({
    profile_id: "11111111-1111-1111-1111-111111111111",
    dailies: []
  });
  startNewDayMock.mockResolvedValue({ updated_count: 0, protected_count: 0 });
});

describe("TaskBoardPage", () => {
  it("does not check new day preview on first open for a profile", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 12, 12, 0, 0));
      fetchTasksMock.mockResolvedValue([]);
      fetchTagsMock.mockResolvedValue([]);

      renderWithQueryClient(<TaskBoardPage />);
      await flushScheduledUiWork();

      expect(fetchNewDayPreviewMock).not.toHaveBeenCalled();
      expect(
        window.localStorage.getItem("taskweb.last_active_day.11111111-1111-1111-1111-111111111111")
      ).toBe("2026-03-12");
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks new day preview using the stored last active day", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 12, 12, 0, 0));
      window.localStorage.setItem(
        "taskweb.last_active_day.11111111-1111-1111-1111-111111111111",
        "2026-03-11"
      );
      fetchTasksMock.mockResolvedValue([]);
      fetchTagsMock.mockResolvedValue([]);

      renderWithQueryClient(<TaskBoardPage />);
      await flushScheduledUiWork();

      expect(fetchNewDayPreviewMock).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        "2026-03-11"
      );
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("can show new day modal again after local day rolls over", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 12, 12, 0, 0));
      window.localStorage.setItem(
        "taskweb.last_active_day.11111111-1111-1111-1111-111111111111",
        "2026-03-11"
      );
      fetchTasksMock.mockResolvedValue([]);
      fetchTagsMock.mockResolvedValue([]);
      fetchNewDayPreviewMock.mockResolvedValue({
        profile_id: "11111111-1111-1111-1111-111111111111",
        dailies: [
          {
            id: "d1",
            title: "Carry over daily",
            previous_period_start: "2026-03-11",
            last_completion_period: null,
            repeat_cadence: "day",
            repeat_every: 1,
            current_streak: 0,
            missed_period_count: 0,
            completion_gold_delta: "1.00",
            streak_protection_cost: "1.00",
            protection_cost: "0.00",
            can_protect: false
          }
        ]
      });

      renderWithQueryClient(<TaskBoardPage />);

      await flushScheduledUiWork();

      expect(screen.getByRole("heading", { name: "New Day" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("heading", { name: "New Day" })).toBeNull();

      await act(async () => {
        vi.setSystemTime(new Date(2026, 2, 13, 9, 0, 0));
        fireEvent.focus(window);
      });
      await flushScheduledUiWork();

      expect(fetchNewDayPreviewMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(fetchNewDayPreviewMock).toHaveBeenLastCalledWith(
        "11111111-1111-1111-1111-111111111111",
        "2026-03-12"
      );
      expect(screen.getByRole("heading", { name: "New Day" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps check and protect mutually exclusive and sends the selected action", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 12, 12, 0, 0));
      window.localStorage.setItem(
        "taskweb.last_active_day.11111111-1111-1111-1111-111111111111",
        "2026-03-11"
      );
      fetchTasksMock.mockResolvedValue([]);
      fetchTagsMock.mockResolvedValue([]);
      fetchNewDayPreviewMock.mockResolvedValue({
        profile_id: "11111111-1111-1111-1111-111111111111",
        dailies: [
          {
            id: "d1",
            title: "Protectable daily",
            previous_period_start: "2026-03-11",
            last_completion_period: "2026-03-09",
            repeat_cadence: "day",
            repeat_every: 1,
            current_streak: 3,
            missed_period_count: 2,
            completion_gold_delta: "5.00",
            streak_protection_cost: "2.00",
            protection_cost: "4.00",
            can_protect: true
          }
        ]
      });

      renderWithQueryClient(<TaskBoardPage />);
      await flushScheduledUiWork();

      const protectBox = screen.getByRole("checkbox", { name: "Protect" }) as HTMLInputElement;
      const checkBox = screen.getByRole("checkbox", { name: "Check" }) as HTMLInputElement;

      fireEvent.click(protectBox);
      expect(protectBox.checked).toBe(true);
      expect(checkBox.checked).toBe(false);

      fireEvent.click(checkBox);
      expect(checkBox.checked).toBe(true);
      expect(protectBox.checked).toBe(false);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Start New Day" }));
        await Promise.resolve();
      });

      expect(startNewDayMock).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", ["d1"], []);
    } finally {
      vi.useRealTimers();
    }
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

  it("sortTasks orders dailies by period-end due date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));

    const dailySooner = makeTask({
      id: "d1",
      task_type: "daily",
      title: "Sooner",
      repeat_cadence: "day",
      repeat_every: 1,
      created_at: "2026-02-01T00:00:00Z"
    });
    const dailyLater = makeTask({
      id: "d2",
      task_type: "daily",
      title: "Later",
      repeat_cadence: "week",
      repeat_every: 1,
      created_at: "2026-02-01T00:00:00Z"
    });

    expect(sortTasks([dailyLater, dailySooner], "Due date (earliest to latest)").map((x) => x.id)).toEqual(["d1", "d2"]);
    expect(sortTasks([dailySooner, dailyLater], "Due date (latest to earliest)").map((x) => x.id)).toEqual(["d2", "d1"]);

    vi.useRealTimers();
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

  it("isDailyCompletedForCurrentPeriod stays correct across DST start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T20:27:00Z"));

    const completedToday = makeTask({
      id: "dst-today",
      task_type: "daily",
      title: "Completed today",
      repeat_cadence: "day",
      repeat_every: 1,
      created_at: "2026-03-01T00:00:00Z",
      last_completion_period: "2026-03-09"
    });
    const completedYesterday = makeTask({
      id: "dst-yesterday",
      task_type: "daily",
      title: "Completed yesterday",
      repeat_cadence: "day",
      repeat_every: 1,
      created_at: "2026-03-01T00:00:00Z",
      last_completion_period: "2026-03-08"
    });

    expect(isDailyCompletedForCurrentPeriod(completedToday)).toBe(true);
    expect(isDailyCompletedForCurrentPeriod(completedYesterday)).toBe(false);

    vi.useRealTimers();
  });
});
