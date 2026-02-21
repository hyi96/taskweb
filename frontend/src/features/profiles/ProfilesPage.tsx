import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createProfile,
  deleteProfile,
  exportProfileTaskApp,
  importProfileTaskApp,
  type TaskAppImportResult
} from "../../shared/api/profiles";
import { useProfileContext } from "./ProfileContext";

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const { profileId, setProfileId, profiles, isProfilesLoading } = useProfileContext();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [popupMessage, setPopupMessage] = useState("");
  const [popupTone, setPopupTone] = useState<"error" | "success">("success");
  const [busyProfileId, setBusyProfileId] = useState("");
  const importInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!popupMessage) {
      return;
    }
    const timer = window.setTimeout(() => setPopupMessage(""), 2500);
    return () => window.clearTimeout(timer);
  }, [popupMessage]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createProfile(name),
    onSuccess: (created) => {
      setNewName("");
      setError("");
      setPopupMessage("");
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setProfileId(created.id);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: (_, deletedId) => {
      setError("");
      setPopupMessage("");
      const remaining = profiles.filter((p) => p.id !== deletedId);
      if (profileId === deletedId) {
        setProfileId(remaining[0]?.id ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
    }
  });

  const downloadArchive = async (profileIdForExport: string, profileName: string) => {
    try {
      setBusyProfileId(profileIdForExport);
      const blob = await exportProfileTaskApp(profileIdForExport);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${profileName.replace(/\s+/g, "_")}.taskapp`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setError("");
      setPopupTone("success");
      setPopupMessage(`Exported ${profileName} successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export profile.";
      setError(message);
      setPopupTone("error");
      setPopupMessage(message);
    } finally {
      setBusyProfileId("");
    }
  };

  const uploadArchive = async (profileIdForImport: string, file: File | null) => {
    if (!file) {
      return;
    }
    try {
      setBusyProfileId(profileIdForImport);
      const result = await importProfileTaskApp(profileIdForImport, file);
      setError("");
      setPopupTone("success");
      setPopupMessage(formatImportSummary(result));
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import profile archive.";
      setError(message);
      setPopupTone("error");
      setPopupMessage(message);
    } finally {
      setBusyProfileId("");
      const input = importInputRefs.current[profileIdForImport];
      if (input) {
        input.value = "";
      }
    }
  };

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
      {popupMessage && <div className={`mini-popup ${popupTone}`}>{popupMessage}</div>}

      <ul className="task-list">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <div>
              <strong>{profile.name}</strong>
              <span className="task-meta">Balance: {profile.gold_balance}</span>
            </div>
            <div className="tag-actions">
              {profileId === profile.id ? <span className="task-meta">Active</span> : null}
              <input
                ref={(element) => {
                  importInputRefs.current[profile.id] = element;
                }}
                type="file"
                accept=".taskapp,.zip"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void uploadArchive(profile.id, file);
                }}
              />
              <button
                type="button"
                className="ghost-button"
                disabled={busyProfileId === profile.id}
                onClick={() => void downloadArchive(profile.id, profile.name)}
              >
                Export
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busyProfileId === profile.id}
                onClick={() => importInputRefs.current[profile.id]?.click()}
              >
                Import
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleteMutation.isPending || busyProfileId === profile.id}
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

function formatImportSummary(result: TaskAppImportResult): string {
  const imported = result.imported;
  return [
    "Import complete:",
    `${imported.tasks} tasks`,
    `${imported.rewards} rewards`,
    `${imported.logs} logs`,
    `(${imported.logs_skipped} skipped)`
  ].join(" ");
}
