import type { ChecklistItem } from "../types/checklist";
import type { LogEntry } from "../types/log";
import type { NewDayPreview } from "../types/newDay";
import type { Profile } from "../types/profile";
import type { StreakBonusRule } from "../types/streakRule";
import type { Tag } from "../types/tag";
import type { Task } from "../types/task";
import type { TaskAppImportResult } from "../api/profiles";

export type CreateTaskInput = {
  profile_id: string;
  task_type: "habit" | "daily" | "todo" | "reward";
  title: string;
  notes?: string;
  tag_ids?: string[];
  gold_delta?: string;
  repeat_cadence?: string;
  repeat_every?: number;
  is_repeatable?: boolean;
};

export type UpdateTaskInput = {
  title?: string;
  notes?: string;
  is_hidden?: boolean;
  tag_ids?: string[];
  gold_delta?: string;
  count_increment?: string;
  count_reset_cadence?: string | null;
  repeat_cadence?: string | null;
  repeat_every?: number;
  streak_goal?: number;
  autocomplete_time_threshold?: string | null;
  due_at?: string | null;
  is_repeatable?: boolean;
};

export type ActivityDurationInput = {
  profileId: string;
  title: string;
  durationSeconds: number;
  taskId?: string | null;
  rewardId?: string | null;
};

export interface ProfilesRepository {
  fetchAll(): Promise<Profile[]>;
  create(name: string): Promise<Profile>;
  delete(profileId: string): Promise<void>;
  exportTaskApp(profileId: string): Promise<Blob>;
  importTaskApp(profileId: string, file: File): Promise<TaskAppImportResult>;
}

export interface TasksRepository {
  fetchAll(profileId: string): Promise<Task[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(taskId: string, profileId: string, input: UpdateTaskInput): Promise<Task>;
  delete(taskId: string, profileId: string): Promise<void>;
  habitIncrement(taskId: string, profileId: string, by?: string): Promise<Task>;
  dailyComplete(taskId: string, profileId: string): Promise<Task>;
  todoComplete(taskId: string, profileId: string): Promise<Task>;
  rewardClaim(taskId: string, profileId: string): Promise<Task>;
}

export interface TagsRepository {
  fetchAll(profileId: string): Promise<Tag[]>;
  create(profileId: string, name: string): Promise<Tag>;
  update(profileId: string, tagId: string, name: string): Promise<Tag>;
  delete(profileId: string, tagId: string): Promise<void>;
}

export interface LogsRepository {
  fetch(
    profileId: string,
    options?: {
      limit?: number;
      from?: string;
      to?: string;
    }
  ): Promise<LogEntry[]>;
}

export interface ChecklistRepository {
  fetch(profileId: string, taskId: string): Promise<ChecklistItem[]>;
  replace(
    profileId: string,
    taskId: string,
    items: Array<{ text: string; is_completed: boolean; sort_order: number }>
  ): Promise<void>;
}

export interface StreakRulesRepository {
  fetch(profileId: string, taskId: string): Promise<StreakBonusRule[]>;
  replace(profileId: string, taskId: string, rules: Array<{ streak_goal: number; bonus_percent: string }>): Promise<void>;
}

export interface ActivityRepository {
  createDurationLog(input: ActivityDurationInput): Promise<void>;
  queueDurationLog(input: ActivityDurationInput): void;
}

export interface NewDayRepository {
  preview(profileId: string): Promise<NewDayPreview>;
  start(profileId: string, checkedDailyIds: string[]): Promise<{ updated_count: number }>;
}

export interface TaskwebRepositories {
  profiles: ProfilesRepository;
  tasks: TasksRepository;
  tags: TagsRepository;
  logs: LogsRepository;
  checklist: ChecklistRepository;
  streakRules: StreakRulesRepository;
  activity: ActivityRepository;
  newDay: NewDayRepository;
}
