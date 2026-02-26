import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentActivityProvider, useCurrentActivity } from "../CurrentActivityContext";
import { CurrentActivityPanel } from "../CurrentActivityPanel";
import { renderWithQueryClient } from "../../../test-utils/render";
import type { Task } from "../../../shared/types/task";

const createActivityDurationLogMock = vi.fn();
const dailyCompleteMock = vi.fn();
let mockedProfileId = "11111111-1111-1111-1111-111111111111";

vi.mock("../../../features/profiles/ProfileContext", () => ({
  useProfileContext: () => ({ profileId: mockedProfileId })
}));

vi.mock("../../../shared/repositories/client", () => ({
  createActivityDurationLog: (...args: unknown[]) => createActivityDurationLogMock(...args),
  queueActivityDurationLog: vi.fn(),
  dailyComplete: (...args: unknown[]) => dailyCompleteMock(...args)
}));

function renderActivity() {
  return renderWithQueryClient(
    <CurrentActivityProvider>
      <CurrentActivityPanel />
    </CurrentActivityProvider>
  );
}

function renderActivityWithTasks(tasks: Task[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  queryClient.setQueryData(["tasks", mockedProfileId], tasks);

  function ActivityTargetHarness() {
    const { setCurrentActivity } = useCurrentActivity();
    return (
      <button type="button" onClick={() => void setCurrentActivity("Auto Daily", { taskId: "daily-1" })}>
        Set Daily Activity
      </button>
    );
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <CurrentActivityProvider>
        <CurrentActivityPanel />
        <ActivityTargetHarness />
      </CurrentActivityProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  mockedProfileId = "11111111-1111-1111-1111-111111111111";
});

describe("CurrentActivity", () => {
  it("supports start/pause/reset/remove and logs elapsed duration on pause", async () => {
    vi.useFakeTimers();
    createActivityDurationLogMock.mockResolvedValue(undefined);

    renderActivity();

    fireEvent.change(screen.getByPlaceholderText("Activity title..."), { target: { value: "Focus Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      await Promise.resolve();
    });
    expect(createActivityDurationLogMock).toHaveBeenCalledTimes(1);
    expect(createActivityDurationLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "11111111-1111-1111-1111-111111111111",
        title: "Focus Work",
        durationSeconds: 3
      })
    );

    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("00:00:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect((screen.getByPlaceholderText("Activity title...") as HTMLInputElement).value).toBe("");
  });

  it("logs running session when profile switches", async () => {
    vi.useFakeTimers();
    createActivityDurationLogMock.mockResolvedValue(undefined);

    const view = renderActivity();
    fireEvent.change(screen.getByPlaceholderText("Activity title..."), { target: { value: "Switch Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    mockedProfileId = "22222222-2222-2222-2222-222222222222";
    view.rerender(
      <CurrentActivityProvider>
        <CurrentActivityPanel />
      </CurrentActivityProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(createActivityDurationLogMock).toHaveBeenCalled();
    expect(createActivityDurationLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "11111111-1111-1111-1111-111111111111",
        title: "Switch Test",
        durationSeconds: 2
      })
    );
  });

  it("auto-completes targeted daily once when autocomplete threshold is crossed", async () => {
    vi.useFakeTimers();
    dailyCompleteMock.mockResolvedValue(undefined);

    const dailyTask = {
      id: "daily-1",
      profile_id: mockedProfileId,
      task_type: "daily",
      title: "Auto Daily",
      notes: "",
      is_hidden: false,
      gold_delta: "1.00",
      current_count: "0.00",
      count_increment: "1.00",
      count_reset_cadence: null,
      repeat_cadence: "day",
      repeat_every: 1,
      current_streak: 0,
      best_streak: 0,
      streak_goal: 0,
      last_completion_period: null,
      autocomplete_time_threshold: "00:00:02",
      due_at: null,
      is_done: false,
      completed_at: null,
      is_repeatable: false,
      is_claimed: false,
      claimed_at: null,
      claim_count: 0,
      last_action_at: null,
      total_actions_count: 0,
      tag_ids: [],
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-01T00:00:00Z"
    } satisfies Task;

    renderActivityWithTasks([dailyTask]);

    fireEvent.click(screen.getByRole("button", { name: "Set Daily Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(dailyCompleteMock).toHaveBeenCalledTimes(1);
    expect(dailyCompleteMock).toHaveBeenCalledWith("daily-1", mockedProfileId);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(dailyCompleteMock).toHaveBeenCalledTimes(1);
  });
});
