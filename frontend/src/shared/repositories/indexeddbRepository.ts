import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChecklistItem } from "../types/checklist";
import type { LogEntry } from "../types/log";
import type { NewDayPreview } from "../types/newDay";
import type { Profile } from "../types/profile";
import type { StreakBonusRule } from "../types/streakRule";
import type { Tag } from "../types/tag";
import type { Task } from "../types/task";
import type { TaskwebRepositories } from "./types";

const DB_NAME = "taskweb_local";
const DB_VERSION = 1;

const STORAGE_PREFIX = "taskweb.profile_id";

type LocalExportPayload = {
  format: "taskweb-indexeddb-v1";
  exported_at: string;
  profile: Profile;
  tags: Tag[];
  tasks: Task[];
  checklist_items: ChecklistItem[];
  streak_bonus_rules: StreakBonusRule[];
  logs: LogEntry[];
};

interface TaskwebDb extends DBSchema {
  profiles: {
    key: string;
    value: Profile;
  };
  tasks: {
    key: string;
    value: Task;
    indexes: { "by-profile": string };
  };
  tags: {
    key: string;
    value: Tag;
    indexes: { "by-profile": string; "by-profile-name": [string, string] };
  };
  checklist_items: {
    key: string;
    value: ChecklistItem;
    indexes: { "by-task": string };
  };
  streak_rules: {
    key: string;
    value: StreakBonusRule;
    indexes: { "by-task": string };
  };
  logs: {
    key: string;
    value: LogEntry;
    indexes: { "by-profile": string; "by-profile-ts": [string, string] };
  };
}

let dbPromise: Promise<IDBPDatabase<TaskwebDb>> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID();
}

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function money(value: number | string) {
  return asNumber(value).toFixed(2);
}

function dateOnlyFromIso(iso: string) {
  return iso.slice(0, 10);
}

function durationString(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readStoredProfileId() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(STORAGE_PREFIX) ?? "";
}

function localDateFromIso(iso: string) {
  const dt = new Date(iso);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function startOfWeekMonday(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addYears(date: Date, years: number) {
  return new Date(date.getFullYear() + years, 0, 1);
}

function periodStartForDaily(task: Task, targetDate = new Date()) {
  const cadence = task.repeat_cadence ?? "day";
  const every = Math.max(1, task.repeat_every || 1);
  const now = new Date(targetDate);
  now.setHours(0, 0, 0, 0);
  const anchor = localDateFromIso(task.created_at);
  anchor.setHours(0, 0, 0, 0);

  if (cadence === "day") {
    const diffDays = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / 86400000));
    return addDays(anchor, Math.floor(diffDays / every) * every);
  }
  if (cadence === "week") {
    const nowStart = startOfWeekMonday(now);
    const anchorStart = startOfWeekMonday(anchor);
    const weeksDiff = Math.max(0, Math.floor((nowStart.getTime() - anchorStart.getTime()) / 86400000 / 7));
    return addDays(anchorStart, Math.floor(weeksDiff / every) * every * 7);
  }
  if (cadence === "month") {
    const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const anchorMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthsDiff = Math.max(0, (nowMonth.getFullYear() - anchorMonth.getFullYear()) * 12 + (nowMonth.getMonth() - anchorMonth.getMonth()));
    return addMonths(anchorMonth, Math.floor(monthsDiff / every) * every);
  }
  if (cadence === "year") {
    const nowYear = new Date(now.getFullYear(), 0, 1);
    const anchorYear = new Date(anchor.getFullYear(), 0, 1);
    const yearsDiff = Math.max(0, nowYear.getFullYear() - anchorYear.getFullYear());
    return addYears(anchorYear, Math.floor(yearsDiff / every) * every);
  }
  return now;
}

function previousDailyPeriodStart(task: Task, currentStart: Date) {
  const cadence = task.repeat_cadence ?? "day";
  const every = Math.max(1, task.repeat_every || 1);
  if (cadence === "day") {
    return addDays(currentStart, -every);
  }
  if (cadence === "week") {
    return addDays(currentStart, -7 * every);
  }
  if (cadence === "month") {
    return addMonths(currentStart, -every);
  }
  if (cadence === "year") {
    return addYears(currentStart, -every);
  }
  return currentStart;
}

function habitResetPeriodStart(task: Task, targetDate = new Date()) {
  const cadence = task.count_reset_cadence;
  const date = new Date(targetDate);
  date.setHours(0, 0, 0, 0);
  if (cadence === "day") {
    return date;
  }
  if (cadence === "week") {
    return startOfWeekMonday(date);
  }
  if (cadence === "month") {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  if (cadence === "year") {
    return new Date(date.getFullYear(), 0, 1);
  }
  return date;
}

function assertProfileId(profileId: string) {
  if (!profileId) {
    throw new Error("profile_id is required.");
  }
}

function requireTaskType(task: Task, type: Task["task_type"]) {
  if (task.task_type !== type) {
    throw new Error(`Action requires ${type} task.`);
  }
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<TaskwebDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("profiles")) {
          db.createObjectStore("profiles", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("tasks")) {
          const tasks = db.createObjectStore("tasks", { keyPath: "id" });
          tasks.createIndex("by-profile", "profile_id");
        }

        if (!db.objectStoreNames.contains("tags")) {
          const tags = db.createObjectStore("tags", { keyPath: "id" });
          tags.createIndex("by-profile", "profile_id");
          tags.createIndex("by-profile-name", ["profile_id", "name"]);
        }

        if (!db.objectStoreNames.contains("checklist_items")) {
          const checklist = db.createObjectStore("checklist_items", { keyPath: "id" });
          checklist.createIndex("by-task", "task_id");
        }

        if (!db.objectStoreNames.contains("streak_rules")) {
          const streak = db.createObjectStore("streak_rules", { keyPath: "id" });
          streak.createIndex("by-task", "task_id");
        }

        if (!db.objectStoreNames.contains("logs")) {
          const logs = db.createObjectStore("logs", { keyPath: "id" });
          logs.createIndex("by-profile", "profile_id");
          logs.createIndex("by-profile-ts", ["profile_id", "timestamp"]);
        }
      },
    });
  }
  return dbPromise;
}

async function ensureSeedProfile() {
  const db = await getDb();
  const profiles = await db.getAll("profiles");
  if (profiles.length > 0) {
    return;
  }
  const profile: Profile = {
    id: makeId(),
    name: "Default",
    gold_balance: "0.00",
    created_at: nowIso(),
  };
  await db.put("profiles", profile);
  if (typeof window !== "undefined") {
    const existing = readStoredProfileId();
    if (!existing) {
      window.localStorage.setItem(STORAGE_PREFIX, profile.id);
    }
  }
}

async function getProfileOrThrow(profileId: string) {
  const db = await getDb();
  const profile = await db.get("profiles", profileId);
  if (!profile) {
    throw new Error("Profile not found.");
  }
  return profile;
}

async function refreshProfilePeriodState(profileId: string) {
  const db = await getDb();
  const tx = db.transaction("tasks", "readwrite");
  const tasks = await tx.store.index("by-profile").getAll(profileId);
  const now = new Date();

  for (const task of tasks) {
    if (task.task_type === "daily" && task.last_completion_period) {
      const current = periodStartForDaily(task, now);
      const previous = previousDailyPeriodStart(task, current);
      const last = new Date(`${task.last_completion_period}T00:00:00`);
      if (last < previous && task.current_streak !== 0) {
        task.current_streak = 0;
        task.updated_at = nowIso();
        await tx.store.put(task);
      }
    }

    if (task.task_type === "habit" && task.count_reset_cadence && task.count_reset_cadence !== "never") {
      const currentCount = asNumber(task.current_count);
      if (currentCount > 0) {
        const anchorIso = task.last_action_at ?? task.created_at;
        const anchorDate = new Date(anchorIso);
        const currentPeriod = habitResetPeriodStart(task, now);
        const anchorPeriod = habitResetPeriodStart(task, anchorDate);
        if (anchorPeriod < currentPeriod) {
          task.current_count = "0.00";
          task.updated_at = nowIso();
          await tx.store.put(task);
        }
      }
    }
  }
  await tx.done;
}

function defaultTask(input: { profile_id: string; task_type: Task["task_type"]; title: string; notes?: string; gold_delta?: string }): Task {
  const now = nowIso();
  return {
    id: makeId(),
    profile_id: input.profile_id,
    task_type: input.task_type,
    title: input.title,
    notes: input.notes ?? "",
    is_hidden: false,
    tag_ids: [],
    gold_delta: money(input.gold_delta ?? (input.task_type === "reward" ? -1 : 1)),
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
    created_at: now,
    updated_at: now,
  };
}

function cloneTask(task: Task) {
  return { ...task, tag_ids: [...task.tag_ids] };
}

async function addLog(input: Omit<LogEntry, "id" | "created_at">) {
  const db = await getDb();
  const log: LogEntry = {
    id: makeId(),
    created_at: nowIso(),
    ...input,
  };
  await db.put("logs", log);
  return log;
}

const indexeddbRepository: TaskwebRepositories = {
  profiles: {
    async fetchAll() {
      await ensureSeedProfile();
      const db = await getDb();
      const profiles = await db.getAll("profiles");
      return profiles.sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async create(name) {
      await ensureSeedProfile();
      const db = await getDb();
      const profile: Profile = {
        id: makeId(),
        name,
        gold_balance: "0.00",
        created_at: nowIso(),
      };
      await db.put("profiles", profile);
      return profile;
    },
    async delete(profileId) {
      await ensureSeedProfile();
      const db = await getDb();
      const allProfiles = await db.getAll("profiles");
      if (allProfiles.length <= 1) {
        throw new Error("At least one profile is required.");
      }

      const tx = db.transaction(["profiles", "tasks", "tags", "checklist_items", "streak_rules", "logs"], "readwrite");
      await tx.objectStore("profiles").delete(profileId);

      const tasks = await tx.objectStore("tasks").index("by-profile").getAll(profileId);
      for (const task of tasks) {
        await tx.objectStore("tasks").delete(task.id);
        const checklist = await tx.objectStore("checklist_items").index("by-task").getAll(task.id);
        for (const item of checklist) {
          await tx.objectStore("checklist_items").delete(item.id);
        }
        const rules = await tx.objectStore("streak_rules").index("by-task").getAll(task.id);
        for (const rule of rules) {
          await tx.objectStore("streak_rules").delete(rule.id);
        }
      }

      const tags = await tx.objectStore("tags").index("by-profile").getAll(profileId);
      for (const tag of tags) {
        await tx.objectStore("tags").delete(tag.id);
      }

      const logs = await tx.objectStore("logs").index("by-profile").getAll(profileId);
      for (const log of logs) {
        await tx.objectStore("logs").delete(log.id);
      }

      await tx.done;
    },
    async exportTaskApp(profileId) {
      await ensureSeedProfile();
      const db = await getDb();
      const profile = await db.get("profiles", profileId);
      if (!profile) {
        throw new Error("Profile not found.");
      }
      const tasks = await db.getAllFromIndex("tasks", "by-profile", profileId);
      const tags = await db.getAllFromIndex("tags", "by-profile", profileId);
      const logs = await db.getAllFromIndex("logs", "by-profile", profileId);
      const checklistItems: ChecklistItem[] = [];
      const streakRules: StreakBonusRule[] = [];
      for (const task of tasks) {
        checklistItems.push(...(await db.getAllFromIndex("checklist_items", "by-task", task.id)));
        streakRules.push(...(await db.getAllFromIndex("streak_rules", "by-task", task.id)));
      }

      const payload: LocalExportPayload = {
        format: "taskweb-indexeddb-v1",
        exported_at: nowIso(),
        profile,
        tasks,
        tags,
        logs,
        checklist_items: checklistItems,
        streak_bonus_rules: streakRules,
      };

      return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    },
    async importTaskApp(profileId, file) {
      await ensureSeedProfile();
      const text = await file.text();
      let parsed: LocalExportPayload;
      try {
        parsed = JSON.parse(text) as LocalExportPayload;
      } catch {
        throw new Error("Local mode import currently supports Taskweb JSON backup only.");
      }

      if (parsed.format !== "taskweb-indexeddb-v1") {
        throw new Error("Unsupported import format for local mode.");
      }

      const db = await getDb();
      const tx = db.transaction(["profiles", "tasks", "tags", "checklist_items", "streak_rules", "logs"], "readwrite");

      const existingTasks = await tx.objectStore("tasks").index("by-profile").getAll(profileId);
      for (const task of existingTasks) {
        await tx.objectStore("tasks").delete(task.id);
        const checklist = await tx.objectStore("checklist_items").index("by-task").getAll(task.id);
        for (const item of checklist) {
          await tx.objectStore("checklist_items").delete(item.id);
        }
        const rules = await tx.objectStore("streak_rules").index("by-task").getAll(task.id);
        for (const rule of rules) {
          await tx.objectStore("streak_rules").delete(rule.id);
        }
      }

      const existingTags = await tx.objectStore("tags").index("by-profile").getAll(profileId);
      for (const tag of existingTags) {
        await tx.objectStore("tags").delete(tag.id);
      }
      const existingLogs = await tx.objectStore("logs").index("by-profile").getAll(profileId);
      for (const log of existingLogs) {
        await tx.objectStore("logs").delete(log.id);
      }

      const profile = await tx.objectStore("profiles").get(profileId);
      if (!profile) {
        throw new Error("Profile not found.");
      }
      profile.gold_balance = parsed.profile.gold_balance;
      await tx.objectStore("profiles").put(profile);

      for (const tag of parsed.tags) {
        await tx.objectStore("tags").put({ ...tag, profile_id: profileId });
      }
      for (const task of parsed.tasks) {
        await tx.objectStore("tasks").put({ ...task, profile_id: profileId });
      }
      for (const item of parsed.checklist_items) {
        await tx.objectStore("checklist_items").put(item);
      }
      for (const rule of parsed.streak_bonus_rules) {
        await tx.objectStore("streak_rules").put(rule);
      }
      for (const log of parsed.logs) {
        await tx.objectStore("logs").put({ ...log, profile_id: profileId });
      }

      await tx.done;

      return {
        profile_id: profileId,
        imported: {
          tags: parsed.tags.length,
          tasks: parsed.tasks.filter((t) => t.task_type !== "reward").length,
          rewards: parsed.tasks.filter((t) => t.task_type === "reward").length,
          checklist_items: parsed.checklist_items.length,
          streak_bonus_rules: parsed.streak_bonus_rules.length,
          logs: parsed.logs.length,
          logs_skipped: 0,
        },
        metadata: { source: "taskweb-indexeddb-v1", exported_at: parsed.exported_at },
      };
    },
  },

  tasks: {
    async fetchAll(profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      await refreshProfilePeriodState(profileId);
      const db = await getDb();
      const tasks = await db.getAllFromIndex("tasks", "by-profile", profileId);
      return tasks.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(cloneTask);
    },

    async create(input) {
      assertProfileId(input.profile_id);
      await ensureSeedProfile();
      await getProfileOrThrow(input.profile_id);
      const db = await getDb();
      const task = defaultTask(input);

      task.notes = input.notes ?? "";
      task.tag_ids = [...(input.tag_ids ?? [])];

      if (input.task_type === "reward") {
        task.is_repeatable = Boolean(input.is_repeatable);
        task.gold_delta = money(-Math.abs(asNumber(input.gold_delta ?? -1)));
      }
      if (input.task_type === "daily") {
        task.repeat_cadence = input.repeat_cadence ?? "day";
        task.repeat_every = Math.max(1, input.repeat_every ?? 1);
      }

      task.updated_at = nowIso();
      await db.put("tasks", task);
      return cloneTask(task);
    },

    async update(taskId, profileId, input) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }

      Object.assign(task, {
        ...("title" in input ? { title: input.title ?? task.title } : {}),
        ...("notes" in input ? { notes: input.notes ?? "" } : {}),
        ...("is_hidden" in input ? { is_hidden: Boolean(input.is_hidden) } : {}),
        ...("tag_ids" in input ? { tag_ids: [...(input.tag_ids ?? [])] } : {}),
      });

      if ("gold_delta" in input && input.gold_delta !== undefined) {
        if (task.task_type === "reward") {
          task.gold_delta = money(-Math.abs(asNumber(input.gold_delta)));
        } else {
          task.gold_delta = money(input.gold_delta);
        }
      }

      if (task.task_type === "habit") {
        if ("count_increment" in input && input.count_increment !== undefined) {
          task.count_increment = money(Math.max(0.01, asNumber(input.count_increment)));
        }
        if ("count_reset_cadence" in input) {
          task.count_reset_cadence = input.count_reset_cadence ?? null;
        }
      }

      if (task.task_type === "daily") {
        if ("repeat_cadence" in input) {
          task.repeat_cadence = input.repeat_cadence ?? null;
        }
        if ("repeat_every" in input && input.repeat_every !== undefined) {
          task.repeat_every = Math.max(1, input.repeat_every);
        }
        if ("streak_goal" in input && input.streak_goal !== undefined) {
          task.streak_goal = Math.max(0, input.streak_goal);
        }
        if ("autocomplete_time_threshold" in input) {
          task.autocomplete_time_threshold = input.autocomplete_time_threshold ?? null;
        }
      }

      if (task.task_type === "todo" && "due_at" in input) {
        task.due_at = input.due_at ?? null;
      }

      if (task.task_type === "reward" && "is_repeatable" in input && input.is_repeatable !== undefined) {
        task.is_repeatable = Boolean(input.is_repeatable);
      }

      task.updated_at = nowIso();
      await db.put("tasks", task);
      return cloneTask(task);
    },

    async delete(taskId, profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }

      const tx = db.transaction(["tasks", "checklist_items", "streak_rules"], "readwrite");
      await tx.objectStore("tasks").delete(taskId);
      const checklist = await tx.objectStore("checklist_items").index("by-task").getAll(taskId);
      for (const item of checklist) {
        await tx.objectStore("checklist_items").delete(item.id);
      }
      const rules = await tx.objectStore("streak_rules").index("by-task").getAll(taskId);
      for (const rule of rules) {
        await tx.objectStore("streak_rules").delete(rule.id);
      }
      await tx.done;
    },

    async habitIncrement(taskId, profileId, by) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tx = db.transaction(["profiles", "tasks", "logs"], "readwrite");
      const task = await tx.objectStore("tasks").get(taskId);
      const profile = await tx.objectStore("profiles").get(profileId);
      if (!task || !profile || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }
      requireTaskType(task, "habit");

      const deltaCount = by === undefined ? asNumber(task.count_increment) : asNumber(by);
      task.current_count = money(asNumber(task.current_count) + deltaCount);
      task.total_actions_count += 1;
      task.last_action_at = nowIso();
      task.updated_at = nowIso();

      const goldDelta = asNumber(task.gold_delta);
      profile.gold_balance = money(asNumber(profile.gold_balance) + goldDelta);

      await tx.objectStore("tasks").put(task);
      await tx.objectStore("profiles").put(profile);
      await tx.objectStore("logs").put({
        id: makeId(),
        profile_id: profileId,
        timestamp: task.last_action_at,
        created_at: nowIso(),
        type: "habit_incremented",
        task_id: task.id,
        reward_id: null,
        gold_delta: money(goldDelta),
        user_gold: profile.gold_balance,
        count_delta: money(deltaCount),
        duration: null,
        title_snapshot: task.title,
      });
      await tx.done;
      return cloneTask(task);
    },

    async dailyComplete(taskId, profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tx = db.transaction(["profiles", "tasks", "streak_rules", "logs"], "readwrite");
      const task = await tx.objectStore("tasks").get(taskId);
      const profile = await tx.objectStore("profiles").get(profileId);
      if (!task || !profile || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }
      requireTaskType(task, "daily");

      const periodStart = periodStartForDaily(task, new Date());
      const periodText = dateOnlyFromIso(periodStart.toISOString());
      if (task.last_completion_period === periodText) {
        throw new Error("already completed for this period");
      }

      const prevStart = previousDailyPeriodStart(task, periodStart);
      const prevText = dateOnlyFromIso(prevStart.toISOString());
      if (task.last_completion_period === prevText) {
        task.current_streak += 1;
      } else {
        task.current_streak = 1;
      }
      task.best_streak = Math.max(task.best_streak, task.current_streak);
      task.last_completion_period = periodText;
      task.last_action_at = nowIso();
      task.total_actions_count += 1;
      task.updated_at = nowIso();

      const rules = await tx.objectStore("streak_rules").index("by-task").getAll(task.id);
      const maxBonus = rules
        .filter((rule) => rule.streak_goal <= task.current_streak)
        .reduce((max, rule) => Math.max(max, asNumber(rule.bonus_percent)), 0);
      const base = asNumber(task.gold_delta);
      const finalGold = base * (1 + maxBonus / 100);
      profile.gold_balance = money(asNumber(profile.gold_balance) + finalGold);

      await tx.objectStore("tasks").put(task);
      await tx.objectStore("profiles").put(profile);
      await tx.objectStore("logs").put({
        id: makeId(),
        profile_id: profileId,
        timestamp: task.last_action_at,
        created_at: nowIso(),
        type: "daily_completed",
        task_id: task.id,
        reward_id: null,
        gold_delta: money(finalGold),
        user_gold: profile.gold_balance,
        count_delta: null,
        duration: null,
        title_snapshot: task.title,
      });
      await tx.done;
      return cloneTask(task);
    },

    async todoComplete(taskId, profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tx = db.transaction(["profiles", "tasks", "logs"], "readwrite");
      const task = await tx.objectStore("tasks").get(taskId);
      const profile = await tx.objectStore("profiles").get(profileId);
      if (!task || !profile || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }
      requireTaskType(task, "todo");
      if (task.is_done) {
        throw new Error("Task is already completed.");
      }

      task.is_done = true;
      task.completed_at = nowIso();
      task.last_action_at = task.completed_at;
      task.total_actions_count += 1;
      task.updated_at = nowIso();

      const delta = asNumber(task.gold_delta);
      profile.gold_balance = money(asNumber(profile.gold_balance) + delta);

      await tx.objectStore("tasks").put(task);
      await tx.objectStore("profiles").put(profile);
      await tx.objectStore("logs").put({
        id: makeId(),
        profile_id: profileId,
        timestamp: task.last_action_at,
        created_at: nowIso(),
        type: "todo_completed",
        task_id: task.id,
        reward_id: null,
        gold_delta: money(delta),
        user_gold: profile.gold_balance,
        count_delta: null,
        duration: null,
        title_snapshot: task.title,
      });
      await tx.done;
      return cloneTask(task);
    },

    async rewardClaim(taskId, profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tx = db.transaction(["profiles", "tasks", "logs"], "readwrite");
      const task = await tx.objectStore("tasks").get(taskId);
      const profile = await tx.objectStore("profiles").get(profileId);
      if (!task || !profile || task.profile_id !== profileId) {
        throw new Error("Task not found.");
      }
      requireTaskType(task, "reward");
      const cost = asNumber(task.gold_delta);
      if (cost >= 0) {
        throw new Error("Reward gold value must be negative.");
      }
      if (!task.is_repeatable && task.is_claimed) {
        throw new Error("Reward already claimed.");
      }
      const nextGold = asNumber(profile.gold_balance) + cost;
      if (nextGold < 0) {
        throw new Error("Insufficient funds to claim this reward.");
      }

      task.claim_count += 1;
      task.is_claimed = true;
      task.claimed_at = nowIso();
      task.last_action_at = task.claimed_at;
      task.total_actions_count += 1;
      task.updated_at = nowIso();
      profile.gold_balance = money(nextGold);

      await tx.objectStore("tasks").put(task);
      await tx.objectStore("profiles").put(profile);
      await tx.objectStore("logs").put({
        id: makeId(),
        profile_id: profileId,
        timestamp: task.last_action_at,
        created_at: nowIso(),
        type: "reward_claimed",
        task_id: task.id,
        reward_id: task.id,
        gold_delta: money(cost),
        user_gold: profile.gold_balance,
        count_delta: null,
        duration: null,
        title_snapshot: task.title,
      });
      await tx.done;
      return cloneTask(task);
    },
  },

  tags: {
    async fetchAll(profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tags = await db.getAllFromIndex("tags", "by-profile", profileId);
      return tags.sort((a, b) => a.name.localeCompare(b.name));
    },
    async create(profileId, name) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const existing = await db.getFromIndex("tags", "by-profile-name", [profileId, name]);
      if (existing) {
        throw new Error("Tag already exists for this profile.");
      }
      const tag: Tag = {
        id: makeId(),
        profile_id: profileId,
        name,
        is_system: false,
        created_at: nowIso(),
      };
      await db.put("tags", tag);
      return tag;
    },
    async update(profileId, tagId, name) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tag = await db.get("tags", tagId);
      if (!tag || tag.profile_id !== profileId) {
        throw new Error("Tag not found.");
      }
      tag.name = name;
      await db.put("tags", tag);
      return tag;
    },
    async delete(profileId, tagId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tag = await db.get("tags", tagId);
      if (!tag || tag.profile_id !== profileId) {
        return;
      }
      const tx = db.transaction(["tags", "tasks"], "readwrite");
      await tx.objectStore("tags").delete(tagId);
      const tasks = await tx.objectStore("tasks").index("by-profile").getAll(profileId);
      for (const task of tasks) {
        if (task.tag_ids.includes(tagId)) {
          task.tag_ids = task.tag_ids.filter((id) => id !== tagId);
          task.updated_at = nowIso();
          await tx.objectStore("tasks").put(task);
        }
      }
      await tx.done;
    },
  },

  logs: {
    async fetch(profileId, options = {}) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      let logs = await db.getAllFromIndex("logs", "by-profile", profileId);

      if (options.from) {
        logs = logs.filter((log) => log.timestamp.slice(0, 10) >= options.from!);
      }
      if (options.to) {
        logs = logs.filter((log) => log.timestamp.slice(0, 10) <= options.to!);
      }

      logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (options.limit !== undefined) {
        logs = logs.slice(0, Math.max(1, Math.min(options.limit, 500)));
      }
      return logs;
    },
  },

  checklist: {
    async fetch(profileId, taskId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId) {
        return [];
      }
      const items = await db.getAllFromIndex("checklist_items", "by-task", taskId);
      return items.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    },
    async replace(profileId, taskId, items) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId || task.task_type !== "todo") {
        throw new Error("Checklist items require TODO task.");
      }
      const tx = db.transaction("checklist_items", "readwrite");
      const existing = await tx.store.index("by-task").getAll(taskId);
      for (const item of existing) {
        await tx.store.delete(item.id);
      }
      for (const item of items) {
        await tx.store.put({
          id: makeId(),
          task_id: taskId,
          text: item.text,
          is_completed: item.is_completed,
          sort_order: item.sort_order,
          created_at: nowIso(),
        });
      }
      await tx.done;
    },
  },

  streakRules: {
    async fetch(profileId, taskId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId) {
        return [];
      }
      const rules = await db.getAllFromIndex("streak_rules", "by-task", taskId);
      return rules.sort((a, b) => a.streak_goal - b.streak_goal);
    },
    async replace(profileId, taskId, rules) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const task = await db.get("tasks", taskId);
      if (!task || task.profile_id !== profileId || task.task_type !== "daily") {
        throw new Error("Streak bonus rules require DAILY task.");
      }
      const tx = db.transaction("streak_rules", "readwrite");
      const existing = await tx.store.index("by-task").getAll(taskId);
      for (const rule of existing) {
        await tx.store.delete(rule.id);
      }
      for (const rule of rules) {
        if (rule.streak_goal < 1) {
          continue;
        }
        await tx.store.put({
          id: makeId(),
          task_id: taskId,
          streak_goal: Math.max(1, Math.floor(rule.streak_goal)),
          bonus_percent: money(rule.bonus_percent),
          created_at: nowIso(),
        });
      }
      await tx.done;
    },
  },

  activity: {
    async createDurationLog(input) {
      assertProfileId(input.profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const profile = await db.get("profiles", input.profileId);
      if (!profile) {
        throw new Error("Profile not found.");
      }
      const duration = Math.max(0, Math.floor(input.durationSeconds));
      if (!input.title.trim() || duration <= 0) {
        return;
      }
      await addLog({
        profile_id: input.profileId,
        timestamp: nowIso(),
        type: "activity_duration",
        task_id: input.taskId ?? null,
        reward_id: input.rewardId ?? null,
        gold_delta: "0.00",
        user_gold: profile.gold_balance,
        count_delta: null,
        duration: durationString(duration),
        title_snapshot: input.title.trim(),
      });
    },
    queueDurationLog(input) {
      // Local mode can write immediately; keep same fire-and-forget behavior.
      void indexeddbRepository.activity.createDurationLog(input);
    },
  },

  newDay: {
    async preview(profileId) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      await refreshProfilePeriodState(profileId);
      const db = await getDb();
      const tasks = await db.getAllFromIndex("tasks", "by-profile", profileId);
      const dailies = tasks
        .filter((task) => task.task_type === "daily")
        .sort((a, b) => a.title.localeCompare(b.title));

      const now = new Date();
      const items = dailies
        .map((daily) => {
          const current = periodStartForDaily(daily, now);
          const previous = previousDailyPeriodStart(daily, current);
          const currentText = dateOnlyFromIso(current.toISOString());
          const previousText = dateOnlyFromIso(previous.toISOString());
          const createdText = dateOnlyFromIso(daily.created_at);
          if (createdText > previousText) {
            return null;
          }
          if (currentText === previousText) {
            return null;
          }
          if (daily.last_completion_period === currentText) {
            return null;
          }
          if (daily.last_completion_period === previousText) {
            return null;
          }
          return {
            id: daily.id,
            title: daily.title,
            previous_period_start: previousText,
            last_completion_period: daily.last_completion_period,
            repeat_cadence: daily.repeat_cadence,
            repeat_every: daily.repeat_every,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return {
        profile_id: profileId,
        dailies: items,
      } satisfies NewDayPreview;
    },

    async start(profileId, checkedDailyIds) {
      assertProfileId(profileId);
      await ensureSeedProfile();
      const db = await getDb();
      const tx = db.transaction("tasks", "readwrite");
      const tasks = await tx.store.index("by-profile").getAll(profileId);
      const checkedSet = new Set(checkedDailyIds);
      const now = new Date();
      let updated = 0;

      for (const daily of tasks.filter((task) => task.task_type === "daily" && checkedSet.has(task.id))) {
        const current = periodStartForDaily(daily, now);
        const currentText = dateOnlyFromIso(current.toISOString());
        const previous = previousDailyPeriodStart(daily, current);
        const previousText = dateOnlyFromIso(previous.toISOString());
        const createdText = dateOnlyFromIso(daily.created_at);

        if (createdText > previousText) {
          continue;
        }

        if (daily.last_completion_period === currentText || daily.last_completion_period === previousText) {
          continue;
        }

        const expectedPrev = dateOnlyFromIso(previousDailyPeriodStart(daily, previous).toISOString());
        if (daily.last_completion_period && daily.last_completion_period === expectedPrev) {
          daily.current_streak += 1;
        } else {
          daily.current_streak = 1;
        }

        daily.best_streak = Math.max(daily.best_streak, daily.current_streak);
        daily.last_completion_period = previousText;
        daily.updated_at = nowIso();
        await tx.store.put(daily);
        updated += 1;
      }

      await tx.done;
      await refreshProfilePeriodState(profileId);
      return { updated_count: updated };
    },
  },
};

export default indexeddbRepository;
