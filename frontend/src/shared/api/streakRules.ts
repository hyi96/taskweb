import { z } from "zod";
import { apiRequest } from "./client";
import type { StreakBonusRule } from "../types/streakRule";

const streakRuleSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  streak_goal: z.number(),
  bonus_percent: z.string(),
  created_at: z.string()
});

const streakRulesSchema = z.array(streakRuleSchema);

export async function fetchStreakRules(profileId: string, taskId: string): Promise<StreakBonusRule[]> {
  const payload = await apiRequest<unknown>("/api/streak-bonus-rules/", {
    profileId,
    query: { task_id: taskId }
  });
  return streakRulesSchema.parse(payload);
}

export async function replaceStreakRules(
  profileId: string,
  taskId: string,
  rules: Array<{ streak_goal: number; bonus_percent: string }>
): Promise<void> {
  const existing = await fetchStreakRules(profileId, taskId);
  await Promise.all(
    existing.map((rule) =>
      apiRequest(`/api/streak-bonus-rules/${rule.id}/`, {
        method: "DELETE",
        profileId
      })
    )
  );

  await Promise.all(
    rules.map((rule) =>
      apiRequest("/api/streak-bonus-rules/", {
        method: "POST",
        body: {
          task: taskId,
          streak_goal: rule.streak_goal,
          bonus_percent: rule.bonus_percent
        }
      })
    )
  );
}
