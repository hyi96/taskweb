import { z } from "zod";
import { apiRequest } from "./client";
import type { LogEntry } from "../types/log";

const logEntrySchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  timestamp: z.string(),
  created_at: z.string(),
  type: z.string(),
  task_id: z.string().uuid().nullable(),
  reward_id: z.string().uuid().nullable(),
  gold_delta: z.string(),
  user_gold: z.string(),
  count_delta: z.string().nullable(),
  duration: z.string().nullable(),
  title_snapshot: z.string()
});

const logsSchema = z.array(logEntrySchema);

type FetchLogsOptions = {
  limit?: number;
  from?: string;
  to?: string;
};

export async function fetchLogs(profileId: string, options: FetchLogsOptions = {}): Promise<LogEntry[]> {
  const payload = await apiRequest<unknown>("/api/logs/", {
    profileId,
    query: {
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.from ? { from: options.from } : {}),
      ...(options.to ? { to: options.to } : {})
    }
  });
  return logsSchema.parse(payload);
}
