import { describe, expect, it } from "vitest";
import { aggregateValues, createBuckets, durationToMinutes } from "../GraphsPage";
import type { LogEntry } from "../../../shared/types/log";
import type { Task } from "../../../shared/types/task";

function makeTask(partial: Partial<Task> & Pick<Task, "id" | "task_type" | "title">): Task {
  return {
    id: partial.id,
    profile_id: "11111111-1111-1111-1111-111111111111",
    task_type: partial.task_type,
    title: partial.title,
    notes: "",
    is_hidden: false,
    tag_ids: [],
    gold_delta: "0.00",
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
    updated_at: "2026-02-20T00:00:00Z",
    ...partial
  };
}

function makeLog(partial: Partial<LogEntry> & Pick<LogEntry, "id" | "timestamp" | "type">): LogEntry {
  return {
    id: partial.id,
    profile_id: "11111111-1111-1111-1111-111111111111",
    timestamp: partial.timestamp,
    created_at: partial.timestamp,
    type: partial.type,
    task_id: partial.task_id ?? null,
    reward_id: partial.reward_id ?? null,
    gold_delta: partial.gold_delta ?? "0.00",
    user_gold: partial.user_gold ?? "0.00",
    count_delta: partial.count_delta ?? null,
    duration: partial.duration ?? null,
    title_snapshot: partial.title_snapshot ?? ""
  };
}

describe("graph helpers", () => {
  it("creates expected bucket counts for each resolution", () => {
    expect(createBuckets("hour")).toHaveLength(72);
    expect(createBuckets("day")).toHaveLength(14);
    expect(createBuckets("week")).toHaveLength(8);
    expect(createBuckets("month")).toHaveLength(12);
    expect(createBuckets("year")).toHaveLength(4);
  });

  it("aggregates habit count_delta and activity time_spent by bucket", () => {
    const buckets = [
      {
        start: new Date("2026-02-20T00:00:00Z"),
        end: new Date("2026-02-21T00:00:00Z"),
        label: "b1"
      },
      {
        start: new Date("2026-02-21T00:00:00Z"),
        end: new Date("2026-02-22T00:00:00Z"),
        label: "b2"
      }
    ];
    const task = makeTask({ id: "task-1", task_type: "habit", title: "Habit" });
    const logs: LogEntry[] = [
      makeLog({
        id: "l1",
        timestamp: "2026-02-20T10:00:00Z",
        type: "habit_incremented",
        task_id: "task-1",
        count_delta: "2.50"
      }),
      makeLog({
        id: "l2",
        timestamp: "2026-02-21T10:00:00Z",
        type: "habit_incremented",
        task_id: "task-1",
        count_delta: "1.25"
      }),
      makeLog({
        id: "l3",
        timestamp: "2026-02-21T11:00:00Z",
        type: "activity_duration",
        title_snapshot: "Deep Work",
        duration: "00:30:00"
      })
    ];

    const countValues = aggregateValues(
      buckets,
      logs,
      [task],
      "habit",
      "count_delta",
      { id: "task-1", name: "Habit" }
    );
    expect(countValues).toEqual([2.5, 1.25]);

    const minutesValues = aggregateValues(
      buckets,
      logs,
      [task],
      "activity",
      "time_spent",
      { id: null, name: "Deep Work", activityTitle: "Deep Work" }
    );
    expect(minutesValues).toEqual([0, 30]);
  });

  it("parses duration strings to minute values", () => {
    expect(durationToMinutes("01:30:00")).toBe(90);
    expect(durationToMinutes("00:00:30")).toBeCloseTo(0.5, 5);
    expect(durationToMinutes(null)).toBe(0);
  });
});
