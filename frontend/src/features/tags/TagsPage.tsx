import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createTag, deleteTag, fetchTags, updateTag } from "../../shared/repositories/client";
import { useProfileContext } from "../profiles/ProfileContext";

export function TagsPage() {
  const { profileId } = useProfileContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  const tagsQuery = useQuery({
    queryKey: ["tags", profileId],
    queryFn: () => fetchTags(profileId),
    enabled: Boolean(profileId)
  });

  const createMutation = useMutation({
    mutationFn: (tagName: string) => createTag(profileId, tagName),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["tags", profileId] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (tagId: string) => deleteTag(profileId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", profileId] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ tagId, tagName }: { tagId: string; tagName: string }) => updateTag(profileId, tagId, tagName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", profileId] });
    }
  });

  if (!profileId) {
    return <div className="status info">Select a profile first.</div>;
  }

  return (
    <div className="board-layout">
      <h2>Tags</h2>
      <div className="quick-add">
        <input
          placeholder="Add tag"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) {
              createMutation.mutate(name.trim());
            }
          }}
        />
        <button type="button" className="action-button" onClick={() => name.trim() && createMutation.mutate(name.trim())}>
          Add tag
        </button>
      </div>

      {tagsQuery.isLoading && <div className="status info">Loading tags...</div>}
      {tagsQuery.isError && <div className="status error">Failed to load tags.</div>}

      <ul className="task-list">
        {(tagsQuery.data ?? []).map((tag) => (
          <li key={tag.id} className="tag-row">
            <input
              value={draftNames[tag.id] ?? tag.name}
              onChange={(event) => setDraftNames((prev) => ({ ...prev, [tag.id]: event.target.value }))}
            />
            <div className="tag-actions tag-actions--tags">
              <button
                type="button"
                className="action-button"
                disabled={tag.is_system}
                onClick={() =>
                  updateMutation.mutate({
                    tagId: tag.id,
                    tagName: (draftNames[tag.id] ?? tag.name).trim()
                  })
                }
              >
                Save
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={tag.is_system}
                onClick={() => deleteMutation.mutate(tag.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
