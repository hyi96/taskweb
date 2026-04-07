import { z } from "zod";
import { apiRequest } from "./client";
import type { NewDayPreview } from "../types/newDay";

const newDayItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  previous_period_start: z.string(),
  last_completion_period: z.string().nullable(),
  repeat_cadence: z.string().nullable(),
  repeat_every: z.number(),
  current_streak: z.number(),
  missed_period_count: z.number(),
  completion_gold_delta: z.string(),
  streak_protection_cost: z.string(),
  protection_cost: z.string(),
  can_protect: z.boolean()
});

const newDayPreviewSchema = z.object({
  profile_id: z.string().uuid(),
  dailies: z.array(newDayItemSchema)
});

const newDayStartResponseSchema = z.object({
  updated_count: z.number(),
  protected_count: z.number().optional()
});

export async function fetchNewDayPreview(profileId: string, lastActiveDate?: string | null): Promise<NewDayPreview> {
  const payload = await apiRequest<unknown>("/api/new-day/", {
    profileId,
    query: lastActiveDate ? { last_active_date: lastActiveDate } : undefined
  });
  return newDayPreviewSchema.parse(payload);
}

export async function startNewDay(
  profileId: string,
  checkedDailyIds: string[],
  protectedDailyIds: string[] = []
): Promise<{ updated_count: number; protected_count?: number }> {
  const payload = await apiRequest<unknown>("/api/new-day/", {
    method: "POST",
    body: {
      profile_id: profileId,
      checked_daily_ids: checkedDailyIds,
      protected_daily_ids: protectedDailyIds
    }
  });
  return newDayStartResponseSchema.parse(payload);
}
