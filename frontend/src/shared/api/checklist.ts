import { z } from "zod";
import { apiRequest } from "./client";
import type { ChecklistItem } from "../types/checklist";

const checklistItemSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  text: z.string(),
  is_completed: z.boolean(),
  sort_order: z.number(),
  created_at: z.string()
});

const checklistItemsSchema = z.array(checklistItemSchema);

export async function fetchChecklistItems(profileId: string, taskId: string): Promise<ChecklistItem[]> {
  const payload = await apiRequest<unknown>("/api/checklist-items/", {
    profileId,
    query: { task_id: taskId }
  });
  return checklistItemsSchema.parse(payload);
}

export async function replaceChecklistItems(
  profileId: string,
  taskId: string,
  items: Array<{ text: string; is_completed: boolean; sort_order: number }>
): Promise<void> {
  const existing = await fetchChecklistItems(profileId, taskId);
  await Promise.all(
    existing.map((item) =>
      apiRequest(`/api/checklist-items/${item.id}/`, {
        method: "DELETE",
        profileId
      })
    )
  );

  await Promise.all(
    items.map((item) =>
      apiRequest("/api/checklist-items/", {
        method: "POST",
        body: {
          task: taskId,
          text: item.text,
          is_completed: item.is_completed,
          sort_order: item.sort_order
        }
      })
    )
  );
}
