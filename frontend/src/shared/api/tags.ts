import { z } from "zod";
import { apiRequest } from "./client";
import type { Tag } from "../types/tag";

const tagSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  name: z.string(),
  is_system: z.boolean(),
  created_at: z.string()
});

const tagsSchema = z.array(tagSchema);

export async function fetchTags(profileId: string): Promise<Tag[]> {
  const payload = await apiRequest<unknown>("/api/tags/", { profileId });
  return tagsSchema.parse(payload);
}

export async function createTag(profileId: string, name: string): Promise<Tag> {
  const payload = await apiRequest<unknown>("/api/tags/", {
    method: "POST",
    body: {
      profile: profileId,
      name
    }
  });
  return tagSchema.parse(payload);
}

export async function deleteTag(profileId: string, tagId: string): Promise<void> {
  await apiRequest(`/api/tags/${tagId}/`, {
    method: "DELETE",
    profileId
  });
}

export async function updateTag(profileId: string, tagId: string, name: string): Promise<Tag> {
  const payload = await apiRequest<unknown>(`/api/tags/${tagId}/`, {
    method: "PATCH",
    profileId,
    body: { name }
  });
  return tagSchema.parse(payload);
}
