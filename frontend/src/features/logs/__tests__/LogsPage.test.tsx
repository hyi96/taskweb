import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../../../test-utils/render";
import { LogsPage, formatGoldDelta, formatLogLine } from "../LogsPage";

const fetchLogsMock = vi.fn();

vi.mock("../../../features/profiles/ProfileContext", () => ({
  useProfileContext: () => ({ profileId: "11111111-1111-1111-1111-111111111111" })
}));

vi.mock("../../../shared/repositories/client", () => ({
  fetchLogs: (...args: unknown[]) => fetchLogsMock(...args)
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("LogsPage", () => {
  it("uses default filters (last 50 from the past 7 days) and refetches on filter changes", async () => {
    fetchLogsMock.mockResolvedValue([]);
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    const formatDate = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    renderWithQueryClient(<LogsPage />);

    await waitFor(() => expect(fetchLogsMock).toHaveBeenCalled());
    await screen.findByText("Recent Logs");
    expect(fetchLogsMock).toHaveBeenLastCalledWith("11111111-1111-1111-1111-111111111111", {
      limit: 50,
      from: formatDate(sevenDaysAgo),
      to: formatDate(today)
    });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "100" } });
    await waitFor(() =>
      expect(fetchLogsMock).toHaveBeenLastCalledWith("11111111-1111-1111-1111-111111111111", {
        limit: 100,
        from: formatDate(sevenDaysAgo),
        to: formatDate(today)
      })
    );

    fireEvent.change(await screen.findByLabelText("from"), { target: { value: "2026-02-10" } });
    await waitFor(() => {
      const calls = fetchLogsMock.mock.calls as Array<[string, { limit: number; from: string; to: string }]>;
      const hasFromUpdate = calls.some(
        ([profileId, options]) =>
          profileId === "11111111-1111-1111-1111-111111111111" &&
          options.limit === 100 &&
          options.from === "2026-02-10" &&
          options.to === formatDate(today)
      );
      expect(hasFromUpdate).toBe(true);
    });

    expect((await screen.findByLabelText("from") as HTMLInputElement).value).toBe("2026-02-10");
  });
});

describe("log helpers", () => {
  it("formats gold deltas and activity/habit log lines", () => {
    expect(formatGoldDelta("3.00")).toBe("+3.00");
    expect(formatGoldDelta("-2.00")).toBe("-2.00");

    const activity = formatLogLine({
      type: "activity_duration",
      timestamp: "2026-02-21T10:00:00Z",
      title_snapshot: "Deep Work",
      gold_delta: "0.00",
      duration: "1:05:09.000000",
      count_delta: null
    });
    expect(activity).toContain("Spent 01:05:09 on activity: Deep Work");

    const habit = formatLogLine({
      type: "habit_incremented",
      timestamp: "2026-02-21T10:00:00Z",
      title_snapshot: "Drink Water",
      gold_delta: "2.00",
      duration: null,
      count_delta: "3.50"
    });
    expect(habit).toContain("count +3.50");
    expect(habit).toContain("gold +2.00");
  });
});
