import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../shared/api/client";
import {
  createTask,
  dailyComplete,
  deleteTask,
  fetchNewDayPreview,
  fetchTags,
  fetchTasks,
  habitIncrement,
  replaceChecklistItems,
  replaceStreakRules,
  rewardClaim,
  startNewDay,
  todoComplete,
  updateTask
} from "../../shared/repositories/client";
import type { NewDayPreviewItem } from "../../shared/types/newDay";
import type { Task } from "../../shared/types/task";
import { useCurrentActivity } from "../activity/CurrentActivityContext";
import { useProfileContext } from "../profiles/ProfileContext";
import { TaskEditorModal } from "./TaskEditorModal";

type HabitFilter = "all" | "hidden";
type DailyFilter = "all" | "due" | "not due" | "hidden";
type TodoFilter = "active" | "scheduled" | "completed" | "hidden";
type RewardFilter = "all" | "one-time" | "repeatable" | "hidden";

const HABIT_SORTS = [
  "Name (A-Z)",
  "Name (Z-A)",
  "Created time (new to old)",
  "Created time (old to new)",
  "Gold value (high to low)",
  "Gold value (low to high)",
  "Count (high to low)",
  "Count (low to high)"
] as const;
const DAILY_SORTS = [
  "Name (A-Z)",
  "Name (Z-A)",
  "Created time (new to old)",
  "Created time (old to new)",
  "Gold value (high to low)",
  "Gold value (low to high)",
  "Due date (earliest to latest)",
  "Due date (latest to earliest)",
  "Current streak (high to low)",
  "Current streak (low to high)",
  "Best streak (high to low)",
  "Best streak (low to high)"
] as const;
const TODO_SORTS = [
  "Name (A-Z)",
  "Name (Z-A)",
  "Created time (new to old)",
  "Created time (old to new)",
  "Gold value (high to low)",
  "Gold value (low to high)",
  "Due date (earliest to latest)",
  "Due date (latest to earliest)"
] as const;
const REWARD_SORTS = [
  "Name (A-Z)",
  "Name (Z-A)",
  "Created time (new to old)",
  "Created time (old to new)",
  "Gold value (high to low)",
  "Gold value (low to high)"
] as const;

type SortLabel = (typeof HABIT_SORTS | typeof DAILY_SORTS | typeof TODO_SORTS | typeof REWARD_SORTS)[number];

const SORTS_STORAGE_KEY_PREFIX = "taskweb.task_sorts";

type EditorPayload = {
  profile_id?: string;
  task_type?: Task["task_type"];
  title: string;
  notes: string;
  is_hidden: boolean;
  tag_ids?: string[];
  gold_delta: string;
  count_increment?: string;
  count_reset_cadence?: string | null;
  repeat_cadence?: string | null;
  repeat_every?: number;
  streak_goal?: number;
  autocomplete_time_threshold?: string | null;
  due_at?: string | null;
  is_repeatable?: boolean;
  checklist_items?: Array<{ text: string; is_completed: boolean; sort_order: number }>;
  streak_bonus_rules?: Array<{ streak_goal: number; bonus_percent: string }>;
};

type EditorState = {
  mode: "create" | "edit";
  task: Task | null;
};

export function localDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskSortsStorageKey(profileId: string) {
  return `${SORTS_STORAGE_KEY_PREFIX}.${profileId}`;
}

function loadStoredSortModes(profileId: string): {
  habitSort: (typeof HABIT_SORTS)[number];
  dailySort: (typeof DAILY_SORTS)[number];
  todoSort: (typeof TODO_SORTS)[number];
  rewardSort: (typeof REWARD_SORTS)[number];
} | null {
  if (typeof window === "undefined" || !profileId) {
    return null;
  }
  const raw = window.localStorage.getItem(taskSortsStorageKey(profileId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      habitSort?: string;
      dailySort?: string;
      todoSort?: string;
      rewardSort?: string;
    };
    const habitSort = HABIT_SORTS.includes(parsed.habitSort as (typeof HABIT_SORTS)[number])
      ? (parsed.habitSort as (typeof HABIT_SORTS)[number])
      : "Name (A-Z)";
    const dailySort = DAILY_SORTS.includes(parsed.dailySort as (typeof DAILY_SORTS)[number])
      ? (parsed.dailySort as (typeof DAILY_SORTS)[number])
      : "Name (A-Z)";
    const todoSort = TODO_SORTS.includes(parsed.todoSort as (typeof TODO_SORTS)[number])
      ? (parsed.todoSort as (typeof TODO_SORTS)[number])
      : "Name (A-Z)";
    const rewardSort = REWARD_SORTS.includes(parsed.rewardSort as (typeof REWARD_SORTS)[number])
      ? (parsed.rewardSort as (typeof REWARD_SORTS)[number])
      : "Name (A-Z)";
    return { habitSort, dailySort, todoSort, rewardSort };
  } catch {
    return null;
  }
}

function storeSortModes(
  profileId: string,
  sorts: {
    habitSort: (typeof HABIT_SORTS)[number];
    dailySort: (typeof DAILY_SORTS)[number];
    todoSort: (typeof TODO_SORTS)[number];
    rewardSort: (typeof REWARD_SORTS)[number];
  }
) {
  if (typeof window === "undefined" || !profileId) {
    return;
  }
  window.localStorage.setItem(taskSortsStorageKey(profileId), JSON.stringify(sorts));
}

function newDaySeenStorageKey(profileId: string, day: string) {
  return `taskweb.new_day_seen.${profileId}.${day}`;
}

function hasSeenNewDayModalToday(profileId: string) {
  if (typeof window === "undefined" || !profileId) {
    return false;
  }
  return window.localStorage.getItem(newDaySeenStorageKey(profileId, localDateString())) === "1";
}

function markNewDayModalSeenToday(profileId: string) {
  if (typeof window === "undefined" || !profileId) {
    return;
  }
  window.localStorage.setItem(newDaySeenStorageKey(profileId, localDateString()), "1");
}

export function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

export function compareDates(a: string | null, b: string | null, desc = false) {
  const av = a ? Date.parse(a) : null;
  const bv = b ? Date.parse(b) : null;
  if (av === null && bv === null) {
    return 0;
  }
  if (av === null) {
    return 1;
  }
  if (bv === null) {
    return -1;
  }
  return desc ? bv - av : av - bv;
}

export function sortTasks(tasks: Task[], sortMode: SortLabel) {
  const list = [...tasks];
  list.sort((a, b) => {
    switch (sortMode) {
      case "Name (A-Z)":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "Name (Z-A)":
        return b.title.localeCompare(a.title, undefined, { sensitivity: "base" });
      case "Created time (new to old)":
        return compareDates(a.created_at, b.created_at, true);
      case "Created time (old to new)":
        return compareDates(a.created_at, b.created_at, false);
      case "Gold value (high to low)":
        return toNumber(b.gold_delta) - toNumber(a.gold_delta);
      case "Gold value (low to high)":
        return toNumber(a.gold_delta) - toNumber(b.gold_delta);
      case "Count (high to low)":
        return toNumber(b.current_count) - toNumber(a.current_count);
      case "Count (low to high)":
        return toNumber(a.current_count) - toNumber(b.current_count);
      case "Current streak (high to low)":
        return b.current_streak - a.current_streak;
      case "Current streak (low to high)":
        return a.current_streak - b.current_streak;
      case "Best streak (high to low)":
        return b.best_streak - a.best_streak;
      case "Best streak (low to high)":
        return a.best_streak - b.best_streak;
      case "Due date (earliest to latest)":
        if (a.task_type === "daily" && b.task_type === "daily") {
          return periodEndForDaily(a).getTime() - periodEndForDaily(b).getTime();
        }
        return compareDates(a.due_at, b.due_at, false);
      case "Due date (latest to earliest)":
        if (a.task_type === "daily" && b.task_type === "daily") {
          return periodEndForDaily(b).getTime() - periodEndForDaily(a).getTime();
        }
        return compareDates(a.due_at, b.due_at, true);
      default:
        return 0;
    }
  });
  return list;
}

export function extractErrorMessage(error: unknown) {
  if (!error) {
    return "";
  }
  const defaultMessage = error instanceof Error ? error.message : "Request failed";
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return defaultMessage;
  }
  const payload = error.payload as Record<string, unknown>;
  if (typeof payload.detail === "string") {
    return `${defaultMessage}: ${payload.detail}`;
  }
  const entries = Object.entries(payload)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.join(", ")}`;
      }
      if (typeof value === "string") {
        return `${key}: ${value}`;
      }
      return null;
    })
    .filter(Boolean);
  return entries.length ? `${defaultMessage}: ${entries.join(" | ")}` : defaultMessage;
}

export function isInsufficientFundsError(error: unknown) {
  const message = extractErrorMessage(error).toLowerCase();
  return message.includes("insufficient funds") || message.includes("insufficient gold");
}

export function filterHidden(task: Task, hiddenOnly: boolean) {
  return hiddenOnly ? task.is_hidden : !task.is_hidden;
}

export function includesQuery(task: Task, query: string) {
  return !query || task.title.toLowerCase().includes(query.toLowerCase());
}

export function matchesSelectedTags(task: Task, selectedTagIds: string[]) {
  if (!selectedTagIds.length) {
    return true;
  }
  return selectedTagIds.some((tagId) => task.tag_ids.includes(tagId));
}

export function currentDailyPeriodStart(task: Task) {
  const cadence = task.repeat_cadence;
  const every = Math.max(1, task.repeat_every || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const anchor = new Date(task.created_at);
  anchor.setHours(0, 0, 0, 0);

  if (cadence === "day") {
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / dayMs));
    return addDays(anchor, Math.floor(diffDays / every) * every);
  }
  if (cadence === "week") {
    const nowStart = startOfWeekMonday(now);
    const anchorStart = startOfWeekMonday(anchor);
    const dayMs = 24 * 60 * 60 * 1000;
    const weeksDiff = Math.max(0, Math.floor((nowStart.getTime() - anchorStart.getTime()) / dayMs / 7));
    return addDays(anchorStart, Math.floor(weeksDiff / every) * every * 7);
  }
  if (cadence === "month") {
    const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const anchorMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthsDiff =
      Math.max(0, (nowMonthStart.getFullYear() - anchorMonthStart.getFullYear()) * 12 + (nowMonthStart.getMonth() - anchorMonthStart.getMonth()));
    return addMonths(anchorMonthStart, Math.floor(monthsDiff / every) * every);
  }
  if (cadence === "year") {
    const nowYearStart = new Date(now.getFullYear(), 0, 1);
    const anchorYearStart = new Date(anchor.getFullYear(), 0, 1);
    const yearsDiff = Math.max(0, nowYearStart.getFullYear() - anchorYearStart.getFullYear());
    return addYears(anchorYearStart, Math.floor(yearsDiff / every) * every);
  }
  return now;
}

export function isDailyCompletedForCurrentPeriod(task: Task) {
  const currentStart = currentDailyPeriodStart(task);
  const year = currentStart.getFullYear();
  const month = String(currentStart.getMonth() + 1).padStart(2, "0");
  const day = String(currentStart.getDate()).padStart(2, "0");
  return task.last_completion_period === `${year}-${month}-${day}`;
}

export function startOfWeekMonday(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function addYears(date: Date, years: number) {
  return new Date(date.getFullYear() + years, 0, 1);
}

export function periodEndForDaily(task: Task) {
  const cadence = task.repeat_cadence;
  const every = Math.max(1, task.repeat_every || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const anchor = new Date(task.created_at);
  anchor.setHours(0, 0, 0, 0);

  if (cadence === "day") {
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / dayMs));
    const block = Math.floor(diffDays / every);
    return addDays(anchor, (block + 1) * every - 1);
  }

  if (cadence === "week") {
    const nowStart = startOfWeekMonday(now);
    const anchorStart = startOfWeekMonday(anchor);
    const dayMs = 24 * 60 * 60 * 1000;
    const weeksDiff = Math.max(0, Math.floor((nowStart.getTime() - anchorStart.getTime()) / dayMs / 7));
    const block = Math.floor(weeksDiff / every);
    return addDays(anchorStart, (block + 1) * every * 7 - 1);
  }

  if (cadence === "month") {
    const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const anchorMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthsDiff = Math.max(
      0,
      (nowMonthStart.getFullYear() - anchorMonthStart.getFullYear()) * 12 + (nowMonthStart.getMonth() - anchorMonthStart.getMonth())
    );
    const block = Math.floor(monthsDiff / every);
    return addDays(addMonths(anchorMonthStart, (block + 1) * every), -1);
  }

  if (cadence === "year") {
    const nowYearStart = new Date(now.getFullYear(), 0, 1);
    const anchorYearStart = new Date(anchor.getFullYear(), 0, 1);
    const yearsDiff = Math.max(0, nowYearStart.getFullYear() - anchorYearStart.getFullYear());
    const block = Math.floor(yearsDiff / every);
    return addDays(addYears(anchorYearStart, (block + 1) * every), -1);
  }

  return now;
}

export function formatDailyDueText(task: Task) {
  const due = periodEndForDaily(task);
  return `Due ${due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

export function formatTodoDueText(dueAt: string) {
  const due = new Date(dueAt);
  const dateLabel = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `Due ${dateLabel} ${timeLabel}`;
}

function TaskColumnHeader({
  title,
  count,
  filter,
  setFilter,
  filterTabs,
  sort,
  setSort,
  sortOptions
}: {
  title: string;
  count: number;
  filter: string;
  setFilter: (value: string) => void;
  filterTabs: string[];
  sort: string;
  setSort: (value: string) => void;
  sortOptions: readonly string[];
}) {
  return (
    <div className="column-header">
      <div className="column-header-top">
        <h3>
          {title} ({count})
        </h3>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          {sortOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-tabs">
        {filterTabs.map((tab) => (
          <button key={tab} type="button" className={filter === tab ? "tab active" : "tab"} onClick={() => setFilter(tab)}>
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TaskBoardPage() {
  const { profileId } = useProfileContext();
  const { setCurrentActivity } = useCurrentActivity();
  const queryClient = useQueryClient();
  const tasksKey = ["tasks", profileId] as const;

  const [search, setSearch] = useState("");
  const [habitFilter, setHabitFilter] = useState<HabitFilter>("all");
  const [dailyFilter, setDailyFilter] = useState<DailyFilter>("all");
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("active");
  const [rewardFilter, setRewardFilter] = useState<RewardFilter>("all");
  const [habitSort, setHabitSort] = useState<(typeof HABIT_SORTS)[number]>("Name (A-Z)");
  const [dailySort, setDailySort] = useState<(typeof DAILY_SORTS)[number]>("Name (A-Z)");
  const [todoSort, setTodoSort] = useState<(typeof TODO_SORTS)[number]>("Name (A-Z)");
  const [rewardSort, setRewardSort] = useState<(typeof REWARD_SORTS)[number]>("Name (A-Z)");
  const [newHabitTitle, setNewHabitTitle] = useState("");
  const [newDailyTitle, setNewDailyTitle] = useState("");
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newRewardTitle, setNewRewardTitle] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [pendingActionTaskIds, setPendingActionTaskIds] = useState<Record<string, true>>({});
  const [insufficientGoldPopup, setInsufficientGoldPopup] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [showNewDayModal, setShowNewDayModal] = useState(false);
  const [checkedNewDayIds, setCheckedNewDayIds] = useState<string[]>([]);
  const checkedNewDayIdsRef = useRef<string[]>([]);
  const sortsHydratedRef = useRef(false);

  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: () => fetchTasks(profileId),
    enabled: Boolean(profileId)
  });
  const tagsQuery = useQuery({
    queryKey: ["tags", profileId, "board-filter"],
    queryFn: () => fetchTags(profileId),
    enabled: Boolean(profileId)
  });
  const newDayQuery = useQuery({
    queryKey: ["new-day", profileId],
    queryFn: () => fetchNewDayPreview(profileId),
    enabled: Boolean(profileId)
  });

  const updateTaskInCache = (updatedTask: Task) => {
    queryClient.setQueryData<Task[]>(tasksKey, (current) =>
      (current ?? []).map((task) => (task.id === updatedTask.id ? updatedTask : task))
    );
  };

  const onActionSuccess = (updatedTask: Task) => {
    updateTaskInCache(updatedTask);
    void queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const habitIncrementMutation = useMutation({
    mutationFn: (task: Task) => habitIncrement(task.id, profileId),
    onSuccess: onActionSuccess
  });
  const dailyCompleteMutation = useMutation({
    mutationFn: (task: Task) => dailyComplete(task.id, profileId),
    onSuccess: onActionSuccess
  });
  const todoCompleteMutation = useMutation({
    mutationFn: (task: Task) => todoComplete(task.id, profileId),
    onSuccess: onActionSuccess
  });
  const rewardClaimMutation = useMutation({
    mutationFn: (task: Task) => rewardClaim(task.id, profileId),
    onSuccess: onActionSuccess
  });

  useEffect(() => {
    if (!isInsufficientFundsError(rewardClaimMutation.error)) {
      return;
    }
    setInsufficientGoldPopup(true);
    const timer = window.setTimeout(() => setInsufficientGoldPopup(false), 2200);
    return () => window.clearTimeout(timer);
  }, [rewardClaimMutation.error]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".card-menu")) {
        return;
      }
      setOpenMenuTaskId(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: (createdTask) => {
      queryClient.setQueryData<Task[]>(tasksKey, (current) => [...(current ?? []), createdTask]);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: Record<string, unknown> }) =>
      updateTask(taskId, profileId, payload),
    onSuccess: updateTaskInCache,
    onSettled: () => queryClient.invalidateQueries({ queryKey: tasksKey })
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId, profileId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tasksKey })
  });
  const startNewDayMutation = useMutation({
    mutationFn: ({ ids }: { ids: string[] }) => startNewDay(profileId, ids),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tasksKey });
      await queryClient.invalidateQueries({ queryKey: ["logs", profileId] });
      await queryClient.invalidateQueries({ queryKey: ["new-day", profileId] });
    }
  });

  const newDayItems = newDayQuery.data?.dailies ?? [];

  useEffect(() => {
    checkedNewDayIdsRef.current = checkedNewDayIds;
  }, [checkedNewDayIds]);

  useEffect(() => {
    setShowNewDayModal(false);
    setCheckedNewDayIds([]);
    checkedNewDayIdsRef.current = [];
    sortsHydratedRef.current = false;
  }, [profileId]);

  useEffect(() => {
    const stored = loadStoredSortModes(profileId);
    if (!stored) {
      setHabitSort("Name (A-Z)");
      setDailySort("Name (A-Z)");
      setTodoSort("Name (A-Z)");
      setRewardSort("Name (A-Z)");
      sortsHydratedRef.current = true;
      return;
    }
    setHabitSort(stored.habitSort);
    setDailySort(stored.dailySort);
    setTodoSort(stored.todoSort);
    setRewardSort(stored.rewardSort);
    sortsHydratedRef.current = true;
  }, [profileId]);

  useEffect(() => {
    if (!sortsHydratedRef.current) {
      return;
    }
    storeSortModes(profileId, { habitSort, dailySort, todoSort, rewardSort });
  }, [profileId, habitSort, dailySort, todoSort, rewardSort]);

  useEffect(() => {
    if (!newDayItems.length) {
      return;
    }
    if (hasSeenNewDayModalToday(profileId)) {
      return;
    }
    setShowNewDayModal(true);
    setCheckedNewDayIds([]);
    checkedNewDayIdsRef.current = [];
    markNewDayModalSeenToday(profileId);
  }, [newDayItems, profileId]);

  const tasks = tasksQuery.data ?? [];
  const grouped = useMemo(
    () => ({
      habits: tasks.filter((t) => t.task_type === "habit"),
      dailies: tasks.filter((t) => t.task_type === "daily"),
      todos: tasks.filter((t) => t.task_type === "todo"),
      rewards: tasks.filter((t) => t.task_type === "reward")
    }),
    [tasks]
  );

  const visibleHabits = useMemo(
    () =>
      sortTasks(
        grouped.habits.filter(
          (t) => filterHidden(t, habitFilter === "hidden") && includesQuery(t, search) && matchesSelectedTags(t, selectedTagIds)
        ),
        habitSort
      ),
    [grouped.habits, habitFilter, search, selectedTagIds, habitSort]
  );
  const visibleDailies = useMemo(() => {
    const filtered = grouped.dailies.filter((t) => {
      if (!filterHidden(t, dailyFilter === "hidden") || !includesQuery(t, search) || !matchesSelectedTags(t, selectedTagIds)) {
        return false;
      }
      if (dailyFilter === "all" || dailyFilter === "hidden") {
        return true;
      }
      const done = isDailyCompletedForCurrentPeriod(t);
      return dailyFilter === "due" ? !done : done;
    });
    return sortTasks(filtered, dailySort);
  }, [grouped.dailies, dailyFilter, search, selectedTagIds, dailySort]);
  const visibleTodos = useMemo(() => {
    const filtered = grouped.todos.filter((t) => {
      if (!filterHidden(t, todoFilter === "hidden") || !includesQuery(t, search) || !matchesSelectedTags(t, selectedTagIds)) {
        return false;
      }
      if (todoFilter === "hidden") {
        return true;
      }
      if (todoFilter === "active") {
        return !t.is_done;
      }
      if (todoFilter === "scheduled") {
        return !t.is_done && Boolean(t.due_at);
      }
      return t.is_done;
    });
    return sortTasks(filtered, todoSort);
  }, [grouped.todos, todoFilter, search, selectedTagIds, todoSort]);
  const visibleRewards = useMemo(() => {
    const filtered = grouped.rewards.filter((t) => {
      if (!filterHidden(t, rewardFilter === "hidden") || !includesQuery(t, search) || !matchesSelectedTags(t, selectedTagIds)) {
        return false;
      }
      if (rewardFilter === "all" || rewardFilter === "hidden") {
        return true;
      }
      return rewardFilter === "repeatable" ? t.is_repeatable : !t.is_repeatable;
    });
    return sortTasks(filtered, rewardSort);
  }, [grouped.rewards, rewardFilter, search, selectedTagIds, rewardSort]);

  const mutationError =
    extractErrorMessage(habitIncrementMutation.error) ||
    extractErrorMessage(dailyCompleteMutation.error) ||
    extractErrorMessage(todoCompleteMutation.error) ||
    (isInsufficientFundsError(rewardClaimMutation.error) ? "" : extractErrorMessage(rewardClaimMutation.error)) ||
    extractErrorMessage(createMutation.error) ||
    extractErrorMessage(updateMutation.error) ||
    extractErrorMessage(deleteMutation.error);

  const handleQuickAdd = async (taskType: Task["task_type"]) => {
    if (!profileId) {
      return;
    }
    if (taskType === "habit" && newHabitTitle.trim()) {
      await createMutation.mutateAsync({ profile_id: profileId, task_type: "habit", title: newHabitTitle.trim(), gold_delta: "1.00" });
      setNewHabitTitle("");
      return;
    }
    if (taskType === "daily" && newDailyTitle.trim()) {
      await createMutation.mutateAsync({
        profile_id: profileId,
        task_type: "daily",
        title: newDailyTitle.trim(),
        repeat_cadence: "day",
        repeat_every: 1,
        gold_delta: "1.00"
      });
      setNewDailyTitle("");
      return;
    }
    if (taskType === "todo" && newTodoTitle.trim()) {
      await createMutation.mutateAsync({ profile_id: profileId, task_type: "todo", title: newTodoTitle.trim(), gold_delta: "1.00" });
      setNewTodoTitle("");
      return;
    }
    if (taskType === "reward" && newRewardTitle.trim()) {
      await createMutation.mutateAsync({
        profile_id: profileId,
        task_type: "reward",
        title: newRewardTitle.trim(),
        gold_delta: "-1.00",
        is_repeatable: false
      });
      setNewRewardTitle("");
    }
  };

  const handleEditorSubmit = async ({ mode, taskId, payload }: { mode: "create" | "edit"; taskId?: string; payload: EditorPayload }) => {
    const { checklist_items, streak_bonus_rules, ...taskPayload } = payload;

    let savedTask: Task;
    if (mode === "create") {
      savedTask = await createMutation.mutateAsync(taskPayload as Parameters<typeof createTask>[0]);
    } else {
      if (!taskId) {
        throw new Error("Task id is required for updates.");
      }
      savedTask = await updateMutation.mutateAsync({ taskId, payload: taskPayload });
    }

    if (savedTask.task_type === "todo" && checklist_items) {
      await replaceChecklistItems(profileId, savedTask.id, checklist_items);
    }
    if (savedTask.task_type === "daily" && streak_bonus_rules) {
      await replaceStreakRules(profileId, savedTask.id, streak_bonus_rules);
    }
    await queryClient.invalidateQueries({ queryKey: tasksKey });
  };

  const handleEditorDelete = async (taskId: string) => {
    await deleteMutation.mutateAsync(taskId);
  };

  const handleSetAsCurrentActivity = async (task: Task) => {
    if (task.task_type === "reward") {
      await setCurrentActivity(task.title, { rewardId: task.id });
      return;
    }
    await setCurrentActivity(task.title, { taskId: task.id });
  };

  const handleToggleHidden = async (task: Task) => {
    await updateMutation.mutateAsync({
      taskId: task.id,
      payload: { is_hidden: !task.is_hidden }
    });
  };

  const markTaskPending = (taskId: string) => {
    setPendingActionTaskIds((current) => ({ ...current, [taskId]: true }));
  };

  const unmarkTaskPending = (taskId: string) => {
    setPendingActionTaskIds((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const isTaskPending = (taskId: string) => Boolean(pendingActionTaskIds[taskId]);

  const handleHabitIncrement = async (task: Task) => {
    markTaskPending(task.id);
    try {
      await habitIncrementMutation.mutateAsync(task);
    } finally {
      unmarkTaskPending(task.id);
    }
  };

  const handleDailyComplete = async (task: Task) => {
    markTaskPending(task.id);
    try {
      await dailyCompleteMutation.mutateAsync(task);
    } finally {
      unmarkTaskPending(task.id);
    }
  };

  const handleTodoComplete = async (task: Task) => {
    markTaskPending(task.id);
    try {
      await todoCompleteMutation.mutateAsync(task);
    } finally {
      unmarkTaskPending(task.id);
    }
  };

  const handleRewardClaim = async (task: Task) => {
    markTaskPending(task.id);
    try {
      await rewardClaimMutation.mutateAsync(task);
    } finally {
      unmarkTaskPending(task.id);
    }
  };

  const renderCardMenu = (task: Task) => (
    <div className="card-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="card-menu-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setOpenMenuTaskId((current) => (current === task.id ? null : task.id));
        }}
      >
        ...
      </button>
      {openMenuTaskId === task.id && (
        <div className="card-menu-popover">
          <button
            type="button"
            className="card-menu-item"
            onClick={() => {
              setOpenMenuTaskId(null);
              void handleSetAsCurrentActivity(task);
            }}
          >
            Set as current activity
          </button>
          <button
            type="button"
            className="card-menu-item"
            onClick={() => {
              setOpenMenuTaskId(null);
              void handleToggleHidden(task);
            }}
          >
            {task.is_hidden ? "Unhide" : "Hide"}
          </button>
        </div>
      )}
    </div>
  );

  if (!profileId) {
    return <div className="status info">Select a profile first.</div>;
  }
  if (tasksQuery.isLoading) {
    return <div className="status info">Loading tasks...</div>;
  }
  if (tasksQuery.isError) {
    return <div className="status error">Failed to load tasks for this profile. {extractErrorMessage(tasksQuery.error)}</div>;
  }

  const closeNewDayModal = () => {
    setShowNewDayModal(false);
    markNewDayModalSeenToday(profileId);
  };

  const toggleNewDayItem = (itemId: string) => {
    setCheckedNewDayIds((current) => {
      const next = current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
      checkedNewDayIdsRef.current = next;
      return next;
    });
  };

  const checkAllNewDayItems = () => {
    const next = newDayItems.map((item) => item.id);
    checkedNewDayIdsRef.current = next;
    setCheckedNewDayIds(next);
  };

  const uncheckAllNewDayItems = () => {
    checkedNewDayIdsRef.current = [];
    setCheckedNewDayIds([]);
  };

  const formatPreviousPeriod = (item: NewDayPreviewItem) => {
    const parsed = new Date(`${item.previous_period_start}T00:00:00`);
    return parsed.toLocaleDateString();
  };

  const handleStartNewDay = async () => {
    const ids = [...checkedNewDayIdsRef.current];
    await startNewDayMutation.mutateAsync({ ids });
    setShowNewDayModal(false);
    setCheckedNewDayIds([]);
    checkedNewDayIdsRef.current = [];
    markNewDayModalSeenToday(profileId);
    closeNewDayModal();
  };

  return (
    <div className="board-layout">
      <div className="board-toolbar">
        <div className="board-toolbar-left">
          <input className="search-input" placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="tag-filter-row">
            {(tagsQuery.data ?? []).map((tag) => {
              const active = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={active ? "tag-chip active" : "tag-chip"}
                  onClick={() =>
                    setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]))
                  }
                >
                  {tag.name}
                </button>
              );
            })}
            {selectedTagIds.length > 0 && (
              <button type="button" className="ghost-button" onClick={() => setSelectedTagIds([])}>
                Clear tags
              </button>
            )}
          </div>
        </div>
      </div>

      {insufficientGoldPopup && <div className="mini-popup">Insufficient gold to claim this reward.</div>}
      {mutationError && <div className="status error">{mutationError}</div>}
      {startNewDayMutation.error && <div className="status error">{extractErrorMessage(startNewDayMutation.error)}</div>}

      {showNewDayModal && (
        <div className="modal-backdrop" onClick={closeNewDayModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>New Day</h2>
              <button type="button" className="ghost-button" onClick={closeNewDayModal}>
                Close
              </button>
            </div>
            <p className="task-meta">You have unchecked dailies from the previous period. Check them off to maintain streaks.</p>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="action-button" onClick={checkAllNewDayItems}>
                Check all
              </button>
              <button type="button" className="ghost-button" onClick={uncheckAllNewDayItems}>
                Uncheck all
              </button>
            </div>
            <ul className="nested-list">
              {newDayItems.map((item) => (
                <li key={item.id}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={checkedNewDayIds.includes(item.id)}
                      onChange={() => toggleNewDayItem(item.id)}
                    />
                    <span>{item.title}</span>
                  </label>
                  <span className="task-meta">Previous period: {formatPreviousPeriod(item)}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="action-button"
                disabled={startNewDayMutation.isPending}
                onClick={() => void handleStartNewDay()}
              >
                Start New Day
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="task-columns">
        <section className="task-column">
          <TaskColumnHeader
            title="Habits"
            count={visibleHabits.length}
            filter={habitFilter}
            setFilter={(value) => setHabitFilter(value as HabitFilter)}
            filterTabs={["all", "hidden"]}
            sort={habitSort}
            setSort={(value) => setHabitSort(value as (typeof HABIT_SORTS)[number])}
            sortOptions={HABIT_SORTS}
          />
          <div className="quick-add">
            <input
              placeholder="Add Habit"
              value={newHabitTitle}
              onChange={(e) => setNewHabitTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleQuickAdd("habit")}
            />
            <button type="button" onClick={() => void handleQuickAdd("habit")}>
              Add
            </button>
          </div>
          <ul className="task-list">
            {visibleHabits.map((task) => (
              <li key={task.id} className="clickable-card" onClick={() => setEditorState({ mode: "edit", task })}>
                {renderCardMenu(task)}
                <strong>{task.title}</strong>
                <span className="task-meta">
                  Count {task.current_count} | Gold {task.gold_delta}
                </span>
                <button
                  className="action-button"
                  type="button"
                  disabled={isTaskPending(task.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleHabitIncrement(task);
                  }}
                >
                  +{toNumber(task.count_increment).toString()}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="task-column">
          <TaskColumnHeader
            title="Dailies"
            count={visibleDailies.length}
            filter={dailyFilter}
            setFilter={(value) => setDailyFilter(value as DailyFilter)}
            filterTabs={["all", "due", "not due", "hidden"]}
            sort={dailySort}
            setSort={(value) => setDailySort(value as (typeof DAILY_SORTS)[number])}
            sortOptions={DAILY_SORTS}
          />
          <div className="quick-add">
            <input
              placeholder="Add Daily"
              value={newDailyTitle}
              onChange={(e) => setNewDailyTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleQuickAdd("daily")}
            />
            <button type="button" onClick={() => void handleQuickAdd("daily")}>
              Add
            </button>
          </div>
          <ul className="task-list">
            {visibleDailies.map((task) => {
              const done = isDailyCompletedForCurrentPeriod(task);
              return (
                <li key={task.id} className="clickable-card" onClick={() => setEditorState({ mode: "edit", task })}>
                  {renderCardMenu(task)}
                  <strong>{task.title}</strong>
                  <span className="task-meta">
                    Streak {task.current_streak} | Gold {task.gold_delta} | {formatDailyDueText(task)}
                  </span>
                  <button
                    className="action-button"
                    type="button"
                    disabled={done || isTaskPending(task.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDailyComplete(task);
                    }}
                  >
                    {done ? "Done for the period" : "Complete"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="task-column">
          <TaskColumnHeader
            title="Todos"
            count={visibleTodos.length}
            filter={todoFilter}
            setFilter={(value) => setTodoFilter(value as TodoFilter)}
            filterTabs={["active", "scheduled", "completed", "hidden"]}
            sort={todoSort}
            setSort={(value) => setTodoSort(value as (typeof TODO_SORTS)[number])}
            sortOptions={TODO_SORTS}
          />
          <div className="quick-add">
            <input
              placeholder="Add Todo"
              value={newTodoTitle}
              onChange={(e) => setNewTodoTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleQuickAdd("todo")}
            />
            <button type="button" onClick={() => void handleQuickAdd("todo")}>
              Add
            </button>
          </div>
          <ul className="task-list">
            {visibleTodos.map((task) => (
              <li key={task.id} className="clickable-card" onClick={() => setEditorState({ mode: "edit", task })}>
                {renderCardMenu(task)}
                <strong>{task.title}</strong>
                {task.due_at && <span className="task-meta">{formatTodoDueText(task.due_at)}</span>}
                <button
                  className="action-button"
                  type="button"
                  disabled={task.is_done || isTaskPending(task.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleTodoComplete(task);
                  }}
                >
                  {task.is_done ? "Done" : "Complete"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="task-column">
          <TaskColumnHeader
            title="Rewards"
            count={visibleRewards.length}
            filter={rewardFilter}
            setFilter={(value) => setRewardFilter(value as RewardFilter)}
            filterTabs={["all", "one-time", "repeatable", "hidden"]}
            sort={rewardSort}
            setSort={(value) => setRewardSort(value as (typeof REWARD_SORTS)[number])}
            sortOptions={REWARD_SORTS}
          />
          <div className="quick-add">
            <input
              placeholder="Add Reward"
              value={newRewardTitle}
              onChange={(e) => setNewRewardTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleQuickAdd("reward")}
            />
            <button type="button" onClick={() => void handleQuickAdd("reward")}>
              Add
            </button>
          </div>
          <ul className="task-list">
            {visibleRewards.map((task) => {
              const claimedLocked = task.is_claimed && !task.is_repeatable;
              return (
                <li key={task.id} className="clickable-card" onClick={() => setEditorState({ mode: "edit", task })}>
                  {renderCardMenu(task)}
                  <strong>{task.title}</strong>
                  <span className="task-meta">Cost {Math.abs(toNumber(task.gold_delta)).toFixed(2)}</span>
                  <button
                    className="action-button"
                    type="button"
                    disabled={claimedLocked || isTaskPending(task.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRewardClaim(task);
                    }}
                  >
                    {claimedLocked ? "Claimed" : "Claim"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {editorState && (
        <TaskEditorModal
          profileId={profileId}
          task={editorState.task}
          onClose={() => setEditorState(null)}
          onSubmit={handleEditorSubmit}
          onDelete={handleEditorDelete}
        />
      )}
    </div>
  );
}
