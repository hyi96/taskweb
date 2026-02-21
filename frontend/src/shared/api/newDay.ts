import { z } from "zod";
import { apiRequest } from "./client";
import type { NewDayPreview } from "../types/newDay";

const newDayItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  previous_period_start: z.string(),
  last_completion_period: z.string().nullable(),
  repeat_cadence: z.string().nullable(),
  repeat_every: z.number()
});

const newDayPreviewSchema = z.object({
  profile_id: z.string().uuid(),
  dailies: z.array(newDayItemSchema)
});

const newDayStartResponseSchema = z.object({
  updated_count: z.number()
});

export async function fetchNewDayPreview(profileId: string): Promise<NewDayPreview> {
  const payload = await apiRequest<unknown>("/api/new-day/", { profileId });
  return newDayPreviewSchema.parse(payload);
}

export async function startNewDay(profileId: string, checkedDailyIds: string[]): Promise<{ updated_count: number }> {
  const payload = await apiRequest<unknown>("/api/new-day/", {
    method: "POST",
    body: {
      profile_id: profileId,
      checked_daily_ids: checkedDailyIds
    }
  });
  return newDayStartResponseSchema.parse(payload);
}
