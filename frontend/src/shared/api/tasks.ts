import { z } from "zod";
import { apiRequest } from "./client";
import type { Task } from "../types/task";

const taskSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  task_type: z.enum(["habit", "daily", "todo", "reward"]),
  title: z.string(),
  notes: z.string(),
  is_hidden: z.boolean(),
  tag_ids: z.array(z.string().uuid()),
  gold_delta: z.string(),
  current_count: z.string(),
  count_increment: z.string(),
  count_reset_cadence: z.string().nullable(),
  repeat_cadence: z.string().nullable(),
  repeat_every: z.number(),
  current_streak: z.number(),
  best_streak: z.number(),
  streak_goal: z.number(),
  last_completion_period: z.string().nullable(),
  autocomplete_time_threshold: z.string().nullable(),
  due_at: z.string().nullable(),
  is_done: z.boolean(),
  completed_at: z.string().nullable(),
  is_repeatable: z.boolean(),
  is_claimed: z.boolean(),
  claimed_at: z.string().nullable(),
  claim_count: z.number(),
  total_actions_count: z.number(),
  last_action_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const tasksSchema = z.array(taskSchema);

const createTaskSchema = z.object({
  profile_id: z.string().uuid(),
  task_type: z.enum(["habit", "daily", "todo", "reward"]),
  title: z.string().min(1),
  notes: z.string().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  gold_delta: z.string().optional(),
  repeat_cadence: z.string().optional(),
  repeat_every: z.number().optional(),
  is_repeatable: z.boolean().optional()
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  is_hidden: z.boolean().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  gold_delta: z.string().optional(),
  count_increment: z.string().optional(),
  count_reset_cadence: z.string().nullable().optional(),
  repeat_cadence: z.string().nullable().optional(),
  repeat_every: z.number().optional(),
  streak_goal: z.number().optional(),
  autocomplete_time_threshold: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  is_repeatable: z.boolean().optional()
});

export async function fetchTasks(profileId: string): Promise<Task[]> {
  const payload = await apiRequest<unknown>("/api/tasks/", { profileId });
  return tasksSchema.parse(payload);
}

export async function createTask(input: z.infer<typeof createTaskSchema>): Promise<Task> {
  const body = createTaskSchema.parse(input);
  const payload = await apiRequest<unknown>("/api/tasks/", {
    method: "POST",
    body
  });
  return taskSchema.parse(payload);
}

export async function habitIncrement(taskId: string, profileId: string, by?: string): Promise<Task> {
  const payload = await apiRequest<unknown>(`/api/tasks/${taskId}/habit-increment/`, {
    method: "POST",
    body: {
      profile_id: profileId,
      ...(by ? { by } : {})
    }
  });
  return taskSchema.parse(payload);
}

export async function dailyComplete(taskId: string, profileId: string): Promise<Task> {
  const payload = await apiRequest<unknown>(`/api/tasks/${taskId}/daily-complete/`, {
    method: "POST",
    body: {
      profile_id: profileId
    }
  });
  return taskSchema.parse(payload);
}

export async function todoComplete(taskId: string, profileId: string): Promise<Task> {
  const payload = await apiRequest<unknown>(`/api/tasks/${taskId}/todo-complete/`, {
    method: "POST",
    body: {
      profile_id: profileId
    }
  });
  return taskSchema.parse(payload);
}

export async function rewardClaim(taskId: string, profileId: string): Promise<Task> {
  const payload = await apiRequest<unknown>(`/api/tasks/${taskId}/reward-claim/`, {
    method: "POST",
    body: {
      profile_id: profileId
    }
  });
  return taskSchema.parse(payload);
}

export async function updateTask(taskId: string, profileId: string, input: z.infer<typeof updateTaskSchema>): Promise<Task> {
  const body = updateTaskSchema.parse(input);
  const payload = await apiRequest<unknown>(`/api/tasks/${taskId}/`, {
    method: "PATCH",
    profileId,
    body
  });
  return taskSchema.parse(payload);
}

export async function deleteTask(taskId: string, profileId: string): Promise<void> {
  await apiRequest<void>(`/api/tasks/${taskId}/`, {
    method: "DELETE",
    profileId
  });
}
