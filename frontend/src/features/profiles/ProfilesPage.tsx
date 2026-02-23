import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createProfile,
  deleteProfile,
  exportProfileTaskApp,
  fetchLocalProfiles,
  importProfileTaskApp,
  migrateLocalProfile,
  storageMode,
  type LocalToCloudMigrationReport,
  type TaskAppImportResult
} from "../../shared/repositories/client";
import { useProfileContext } from "./ProfileContext";

export function ProfilesPage() {
  const isCloudMode = storageMode === "api";
  const queryClient = useQueryClient();
  const { profileId, setProfileId, profiles, isProfilesLoading } = useProfileContext();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [popupMessage, setPopupMessage] = useState("");
  const [popupTone, setPopupTone] = useState<"error" | "success">("success");
  const [busyProfileId, setBusyProfileId] = useState("");
  const [localProfiles, setLocalProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [localSourceId, setLocalSourceId] = useState("");
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

  useEffect(() => {
    if (!isCloudMode) {
      return;
    }
    let active = true;
    const loadLocalProfiles = async () => {
      try {
        const items = await fetchLocalProfiles();
        if (!active) {
          return;
        }
        setLocalProfiles(items.map((item) => ({ id: item.id, name: item.name })));
        setLocalSourceId((current) => current || items[0]?.id || "");
      } catch {
        if (active) {
          setLocalProfiles([]);
          setLocalSourceId("");
        }
      }
    };
    void loadLocalProfiles();
    return () => {
      active = false;
    };
  }, [isCloudMode]);

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

  const runLocalMigration = async (targetProfileId: string, targetProfileName: string) => {
    if (!localSourceId) {
      setPopupTone("error");
      setPopupMessage("Select a local profile to migrate.");
      return;
    }
    const sourceName = localProfiles.find((item) => item.id === localSourceId)?.name ?? "local profile";
    if (!window.confirm(`Migrate local profile "${sourceName}" into cloud profile "${targetProfileName}"?`)) {
      return;
    }
    try {
      setBusyProfileId(targetProfileId);
      const report = await migrateLocalProfile(localSourceId, targetProfileId);
      setError("");
      setPopupTone(report.errors.length ? "error" : "success");
      setPopupMessage(formatLocalMigrationSummary(report, sourceName, targetProfileName));
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to migrate local data.";
      setError(message);
      setPopupTone("error");
      setPopupMessage(message);
    } finally {
      setBusyProfileId("");
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
      {!isCloudMode && <div className="status info">Import/export is available in cloud mode only.</div>}
      {isCloudMode && (
        <div className="inline-controls">
          <label htmlFor="local-source-profile">Local source</label>
          <select
            id="local-source-profile"
            value={localSourceId}
            onChange={(event) => setLocalSourceId(event.target.value)}
          >
            {localProfiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
              {isCloudMode && (
                <>
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
                    className="ghost-button"
                    disabled={busyProfileId === profile.id || !localSourceId}
                    onClick={() => void runLocalMigration(profile.id, profile.name)}
                  >
                    Migrate local
                  </button>
                </>
              )}
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

function formatLocalMigrationSummary(
  report: LocalToCloudMigrationReport,
  sourceName: string,
  targetName: string
): string {
  const chunks = Object.entries(report.counts).map(([key, value]) => {
    return `${key}: +${value.created} ~${value.updated} =${value.skipped} !${value.errors}`;
  });
  return [`Migrated "${sourceName}" to "${targetName}".`, ...chunks].join(" ");
}
