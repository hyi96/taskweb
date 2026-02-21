import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createProfile, deleteProfile } from "../../shared/api/profiles";
import { useProfileContext } from "./ProfileContext";

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const { profileId, setProfileId, profiles, isProfilesLoading } = useProfileContext();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: (name: string) => createProfile(name),
    onSuccess: (created) => {
      setNewName("");
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setProfileId(created.id);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: (_, deletedId) => {
      setError("");
      const remaining = profiles.filter((p) => p.id !== deletedId);
      if (profileId === deletedId) {
        setProfileId(remaining[0]?.id ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
    }
  });

  return (
    <div className="board-layout">
      <h2>Profiles</h2>
      <div className="quick-add">
        <input
          placeholder="New profile name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && newName.trim()) {
              createMutation.mutate(newName.trim());
            }
          }}
        />
        <button
          type="button"
          className="action-button"
          disabled={!newName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate(newName.trim())}
        >
          Add profile
        </button>
      </div>

      {isProfilesLoading && <div className="status info">Loading profiles...</div>}
      {error && <div className="status error">{error}</div>}

      <ul className="task-list">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <div>
              <strong>{profile.name}</strong>
              <span className="task-meta">Balance: {profile.gold_balance}</span>
            </div>
            <div className="tag-actions">
              {profileId === profile.id ? <span className="task-meta">Active</span> : null}
              <button
                type="button"
                className="danger-button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (!window.confirm(`Delete profile "${profile.name}"? This will remove its data.`)) {
                    return;
                  }
                  deleteMutation.mutate(profile.id, {
                    onError: (err) => {
                      const message = err instanceof Error ? err.message : "Failed to delete profile.";
                      setError(message);
                    }
                  });
                }}
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
