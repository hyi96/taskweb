import { apiRequest } from "../api/client";
import type { Profile } from "../types/profile";
import indexeddbRepository from "./indexeddbRepository";

type LocalExportPayload = {
  format: "taskweb-indexeddb-v1";
  exported_at: string;
  profile: Profile;
  tags: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  checklist_items: Array<Record<string, unknown>>;
  streak_bonus_rules: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type LocalToCloudMigrationReport = {
  target_profile_id: string;
  source_profile_id: string | null;
  counts: Record<string, { created: number; updated: number; skipped: number; errors: number }>;
  id_map: Record<string, Record<string, string>>;
  errors: Array<{ entity: string; id: string | null; error: string }>;
};

async function readLocalPayload(profileId: string): Promise<LocalExportPayload> {
  const blob = await indexeddbRepository.profiles.exportTaskApp(profileId);
  const text = await blob.text();
  const parsed = JSON.parse(text) as LocalExportPayload;
  return parsed;
}

export async function fetchLocalProfilesForMigration(): Promise<Profile[]> {
  return indexeddbRepository.profiles.fetchAll();
}

export async function migrateLocalProfileToCloud({
  localProfileId,
  targetCloudProfileId,
}: {
  localProfileId: string;
  targetCloudProfileId: string;
}): Promise<LocalToCloudMigrationReport> {
  const payload = await readLocalPayload(localProfileId);
  return apiRequest<LocalToCloudMigrationReport>(`/api/profiles/${targetCloudProfileId}/migrate-local/`, {
    method: "POST",
    body: payload,
  });
}
