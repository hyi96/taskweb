import { getRepositories, setStorageMode, storageMode } from "./index";
import type {
  ActivityDurationInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "./types";
export type { TaskAppImportResult } from "../api/profiles";

export { storageMode };
export { setStorageMode };

export async function fetchProfiles() {
  return getRepositories().profiles.fetchAll();
}

export async function createProfile(name: string) {
  return getRepositories().profiles.create(name);
}

export async function deleteProfile(profileId: string) {
  return getRepositories().profiles.delete(profileId);
}

export async function exportProfileTaskApp(profileId: string) {
  return getRepositories().profiles.exportTaskApp(profileId);
}

export async function importProfileTaskApp(profileId: string, file: File) {
  return getRepositories().profiles.importTaskApp(profileId, file);
}

export async function fetchTasks(profileId: string) {
  return getRepositories().tasks.fetchAll(profileId);
}

export async function createTask(input: CreateTaskInput) {
  return getRepositories().tasks.create(input);
}

export async function updateTask(taskId: string, profileId: string, input: UpdateTaskInput) {
  return getRepositories().tasks.update(taskId, profileId, input);
}

export async function deleteTask(taskId: string, profileId: string) {
  return getRepositories().tasks.delete(taskId, profileId);
}

export async function habitIncrement(taskId: string, profileId: string, by?: string) {
  return getRepositories().tasks.habitIncrement(taskId, profileId, by);
}

export async function dailyComplete(taskId: string, profileId: string) {
  return getRepositories().tasks.dailyComplete(taskId, profileId);
}

export async function todoComplete(taskId: string, profileId: string) {
  return getRepositories().tasks.todoComplete(taskId, profileId);
}

export async function rewardClaim(taskId: string, profileId: string) {
  return getRepositories().tasks.rewardClaim(taskId, profileId);
}

export async function fetchTags(profileId: string) {
  return getRepositories().tags.fetchAll(profileId);
}

export async function createTag(profileId: string, name: string) {
  return getRepositories().tags.create(profileId, name);
}

export async function updateTag(profileId: string, tagId: string, name: string) {
  return getRepositories().tags.update(profileId, tagId, name);
}

export async function deleteTag(profileId: string, tagId: string) {
  return getRepositories().tags.delete(profileId, tagId);
}

export async function fetchLogs(profileId: string, options?: { limit?: number; from?: string; to?: string }) {
  return getRepositories().logs.fetch(profileId, options);
}

export async function fetchChecklistItems(profileId: string, taskId: string) {
  return getRepositories().checklist.fetch(profileId, taskId);
}

export async function replaceChecklistItems(
  profileId: string,
  taskId: string,
  items: Array<{ text: string; is_completed: boolean; sort_order: number }>
) {
  return getRepositories().checklist.replace(profileId, taskId, items);
}

export async function fetchStreakRules(profileId: string, taskId: string) {
  return getRepositories().streakRules.fetch(profileId, taskId);
}

export async function replaceStreakRules(
  profileId: string,
  taskId: string,
  rules: Array<{ streak_goal: number; bonus_percent: string }>
) {
  return getRepositories().streakRules.replace(profileId, taskId, rules);
}

export async function createActivityDurationLog(input: ActivityDurationInput) {
  return getRepositories().activity.createDurationLog(input);
}

export function queueActivityDurationLog(input: ActivityDurationInput) {
  return getRepositories().activity.queueDurationLog(input);
}

export async function fetchNewDayPreview(profileId: string) {
  return getRepositories().newDay.preview(profileId);
}

export async function startNewDay(profileId: string, checkedDailyIds: string[]) {
  return getRepositories().newDay.start(profileId, checkedDailyIds);
}
