import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentActivityProvider } from "../CurrentActivityContext";
import { CurrentActivityPanel } from "../CurrentActivityPanel";
import { renderWithQueryClient } from "../../../test-utils/render";

const createActivityDurationLogMock = vi.fn();
let mockedProfileId = "11111111-1111-1111-1111-111111111111";

vi.mock("../../../features/profiles/ProfileContext", () => ({
  useProfileContext: () => ({ profileId: mockedProfileId })
}));

vi.mock("../../../shared/repositories/client", () => ({
  createActivityDurationLog: (...args: unknown[]) => createActivityDurationLogMock(...args),
  queueActivityDurationLog: vi.fn()
}));

function renderActivity() {
  return renderWithQueryClient(
    <CurrentActivityProvider>
      <CurrentActivityPanel />
    </CurrentActivityProvider>
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
});
