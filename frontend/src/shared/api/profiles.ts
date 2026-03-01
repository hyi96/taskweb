import { z } from "zod";
import { apiRequest } from "./client";
import type { Profile } from "../types/profile";

const profileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gold_balance: z.string(),
  created_at: z.string()
});

const profilesSchema = z.array(profileSchema);

export async function fetchProfiles(): Promise<Profile[]> {
  const payload = await apiRequest<unknown>("/api/profiles/");
  return profilesSchema.parse(payload);
}

export async function createProfile(name: string): Promise<Profile> {
  const payload = await apiRequest<unknown>("/api/profiles/", {
    method: "POST",
    body: { name }
  });
  return profileSchema.parse(payload);
}

export async function deleteProfile(profileId: string): Promise<void> {
  await apiRequest(`/api/profiles/${profileId}/`, {
    method: "DELETE"
  });
}

export type TaskAppImportResult = {
  profile_id: string;
  imported: {
    tags: number;
    tasks: number;
    rewards: number;
    checklist_items: number;
    streak_bonus_rules: number;
    logs: number;
    logs_skipped: number;
  };
  metadata: Record<string, unknown>;
};

export async function exportProfileTaskApp(profileId: string): Promise<Blob> {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = browserTimezone ? `?timezone=${encodeURIComponent(browserTimezone)}` : "";
  return apiRequest<Blob>(`/api/profiles/${profileId}/export-taskapp/${query}`, {
    method: "GET",
    responseType: "blob"
  });
}

export async function importProfileTaskApp(profileId: string, file: File): Promise<TaskAppImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browserTimezone) {
    formData.append("timezone", browserTimezone);
  }
  return apiRequest<TaskAppImportResult>(`/api/profiles/${profileId}/import-taskapp/`, {
    method: "POST",
    body: formData
  });
}
