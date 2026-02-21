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
