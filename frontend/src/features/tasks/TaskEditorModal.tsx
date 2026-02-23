import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../shared/api/client";
import { fetchChecklistItems, fetchStreakRules, fetchTags } from "../../shared/repositories/client";
import type { Tag } from "../../shared/types/tag";
import type { Task, TaskType } from "../../shared/types/task";

type TaskEditorSubmit = {
  mode: "create" | "edit";
  taskId?: string;
  payload: {
    profile_id?: string;
    task_type?: TaskType;
    title: string;
    notes: string;
    is_hidden: boolean;
    tag_ids?: string[];
    gold_delta: string;
    count_increment?: string;
    count_reset_cadence?: string | null;
    repeat_cadence?: string | null;
    repeat_every?: number;
    autocomplete_time_threshold?: string | null;
    due_at?: string | null;
    is_repeatable?: boolean;
    checklist_items?: Array<{ text: string; is_completed: boolean; sort_order: number }>;
    streak_bonus_rules?: Array<{ streak_goal: number; bonus_percent: string }>;
  };
};

type TaskEditorModalProps = {
  profileId: string;
  task?: Task | null;
  onClose: () => void;
  onSubmit: (data: TaskEditorSubmit) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
};

const DAILY_CADENCE_OPTIONS = ["day", "week", "month", "year"] as const;
const HABIT_RESET_OPTIONS = ["never", "day", "week", "month", "year"] as const;

function toDatetimeLocal(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}`;
}

function toIsoUtcFromDatetimeLocal(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, y, m, d, hh, mm] = match;
  const year = Number(y);
  const month = Number(m) - 1;
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0)).toISOString();
}

function toTodoDueParts(value: string | null) {
  const local = toDatetimeLocal(value);
  if (!local) {
    return { datePart: "", timePart: "23:59" };
  }
  const [datePart, timePart] = local.split("T");
  return {
    datePart: datePart ?? "",
    timePart: (timePart ?? "23:59").slice(0, 5) || "23:59",
  };
}

function toDueAtIso(datePart: string, timePart: string) {
  if (!datePart.trim()) {
    return null;
  }
  const safeTime = /^\d{2}:\d{2}$/.test(timePart) ? timePart : "23:59";
  return toIsoUtcFromDatetimeLocal(`${datePart}T${safeTime}`);
}

function formatLastAction(task: Task | null) {
  if (!task?.last_action_at) {
    return "Never";
  }
  const label =
    task.task_type === "habit" ? "Last incremented" : task.task_type === "reward" ? "Last claimed" : "Last completed";
  return `${label}: ${new Date(task.last_action_at).toLocaleString()}`;
}

function formatApiError(error: unknown) {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return error instanceof Error ? error.message : "Request failed.";
  }
  const payload = error.payload as Record<string, unknown>;
  if (typeof payload.detail === "string") {
    return payload.detail;
  }
  const entries = Object.entries(payload)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.join(", ")}`;
      }
      if (typeof value === "string") {
        return `${key}: ${value}`;
      }
      return null;
    })
    .filter(Boolean);
  return entries.length ? entries.join(" | ") : error.message;
}

export function TaskEditorModal({ profileId, task, onClose, onSubmit, onDelete }: TaskEditorModalProps) {
  const isEdit = Boolean(task);
  const [taskType, setTaskType] = useState<TaskType>(task?.task_type ?? "habit");
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [isHidden, setIsHidden] = useState(task?.is_hidden ?? false);
  const [goldDelta, setGoldDelta] = useState(task?.gold_delta ?? (taskType === "reward" ? "-1.00" : "1.00"));
  const [countIncrement, setCountIncrement] = useState(task?.count_increment ?? "1.00");
  const [countResetCadence, setCountResetCadence] = useState(task?.count_reset_cadence ?? "never");
  const [repeatCadence, setRepeatCadence] = useState(task?.repeat_cadence ?? "day");
  const [repeatEvery, setRepeatEvery] = useState(task?.repeat_every ?? 1);
  const [autocompleteThreshold, setAutocompleteThreshold] = useState(task?.autocomplete_time_threshold ?? "");
  const initialTodoDue = toTodoDueParts(task?.due_at ?? null);
  const [dueDate, setDueDate] = useState(initialTodoDue.datePart);
  const [dueTime, setDueTime] = useState(initialTodoDue.timePart || "23:59");
  const [isRepeatable, setIsRepeatable] = useState(task?.is_repeatable ?? false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState<Array<{ text: string; is_completed: boolean }>>([]);
  const [newChecklistText, setNewChecklistText] = useState("");
  const [streakRulesDraft, setStreakRulesDraft] = useState<Array<{ streak_goal: number; bonus_percent: string }>>([]);
  const [newRuleGoal, setNewRuleGoal] = useState(7);
  const [newRuleBonus, setNewRuleBonus] = useState("10.00");
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(task?.tag_ids ?? []);

  useEffect(() => {
    if (!task) {
      return;
    }
    setTaskType(task.task_type);
    setTitle(task.title);
    setNotes(task.notes);
    setIsHidden(task.is_hidden);
    setGoldDelta(task.gold_delta);
    setCountIncrement(task.count_increment);
    setCountResetCadence(task.count_reset_cadence ?? "never");
    setRepeatCadence(task.repeat_cadence ?? "day");
    setRepeatEvery(task.repeat_every);
    setAutocompleteThreshold(task.autocomplete_time_threshold ?? "");
    const dueParts = toTodoDueParts(task.due_at);
    setDueDate(dueParts.datePart);
    setDueTime(dueParts.timePart || "23:59");
    setIsRepeatable(task.is_repeatable);
    setSelectedTagIds(task.tag_ids ?? []);
  }, [task]);

  useEffect(() => {
    if (!task) {
      setSelectedTagIds([]);
    }
  }, [task]);

  useEffect(() => {
    if (isEdit) {
      return;
    }
    if (taskType === "todo") {
      if (!dueTime) {
        setDueTime("23:59");
      }
    }
  }, [isEdit, taskType, dueDate, dueTime]);

  useEffect(() => {
    const loadTags = async () => {
      const tags = await fetchTags(profileId);
      setAvailableTags(tags);
    };
    void loadTags();
  }, [profileId]);

  useEffect(() => {
    const loadRelated = async () => {
      if (!task?.id) {
        setChecklistDraft([]);
        setStreakRulesDraft([]);
        return;
      }
      if (task.task_type === "todo") {
        const items = await fetchChecklistItems(profileId, task.id);
        setChecklistDraft(items.map((item) => ({ text: item.text, is_completed: item.is_completed })));
      } else {
        setChecklistDraft([]);
      }
      if (task.task_type === "daily") {
        const rules = await fetchStreakRules(profileId, task.id);
        setStreakRulesDraft(
          rules.map((rule) => ({
            streak_goal: rule.streak_goal,
            bonus_percent: Number(rule.bonus_percent).toFixed(2)
          }))
        );
      } else {
        setStreakRulesDraft([]);
      }
    };
    void loadRelated();
  }, [profileId, task?.id, task?.task_type]);

  const titleText = isEdit ? `Edit ${taskType}` : "Create task";
  const lastActionText = useMemo(() => formatLastAction(task ?? null), [task]);

  const validate = () => {
    if (!title.trim()) {
      return "Title is required.";
    }
    if (!Number.isFinite(Number(goldDelta))) {
      return "Gold value must be a valid number.";
    }
    if (taskType === "habit" && (!Number.isFinite(Number(countIncrement)) || Number(countIncrement) <= 0)) {
      return "Habit increment must be greater than 0.";
    }
    if (taskType === "daily") {
      if (!DAILY_CADENCE_OPTIONS.includes(repeatCadence as (typeof DAILY_CADENCE_OPTIONS)[number])) {
        return "Daily cadence must be day, week, month, or year.";
      }
      if (!Number.isInteger(repeatEvery) || repeatEvery < 1) {
        return "Daily repeat every must be at least 1.";
      }
      if (autocompleteThreshold && !/^\d{1,3}:\d{2}:\d{2}$/.test(autocompleteThreshold)) {
        return "Autocomplete threshold must be HH:MM:SS.";
      }
    }
    if (taskType === "reward" && Number(goldDelta) >= 0) {
      return "Reward gold value must be negative.";
    }
    return "";
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const shared = {
      title: title.trim(),
      notes,
      is_hidden: isHidden,
      tag_ids: selectedTagIds,
      gold_delta: Number(goldDelta).toFixed(2)
    };

    const payload: TaskEditorSubmit["payload"] = isEdit
      ? { ...shared }
      : {
          ...shared,
          profile_id: profileId,
          task_type: taskType
        };

    if (taskType === "habit") {
      payload.count_increment = Number(countIncrement).toFixed(2);
      payload.count_reset_cadence = countResetCadence;
    }

    if (taskType === "daily") {
      payload.repeat_cadence = repeatCadence;
      payload.repeat_every = repeatEvery;
      payload.autocomplete_time_threshold = autocompleteThreshold.trim() || null;
      payload.streak_bonus_rules = streakRulesDraft
        .filter((rule) => rule.streak_goal > 0)
        .map((rule) => ({
          streak_goal: rule.streak_goal,
          bonus_percent: Number(rule.bonus_percent || 0).toFixed(2)
        }));
    }

    if (taskType === "todo") {
      payload.due_at = toDueAtIso(dueDate, dueTime);
      payload.checklist_items = checklistDraft
        .filter((item) => item.text.trim())
        .map((item, index) => ({
          text: item.text.trim(),
          is_completed: item.is_completed,
          sort_order: index
        }));
    }

    if (taskType === "reward") {
      payload.is_repeatable = isRepeatable;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        mode: isEdit ? "edit" : "create",
        taskId: task?.id,
        payload
      });
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task?.id) {
      return;
    }
    if (!window.confirm(`Delete "${task.title}"?`)) {
      return;
    }
    setIsDeleting(true);
    setError("");
    try {
      await onDelete(task.id);
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{titleText}</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="form-grid">
          <label>
            Task type
            <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} disabled={isEdit}>
              <option value="habit">habit</option>
              <option value="daily">daily</option>
              <option value="todo">todo</option>
              <option value="reward">reward</option>
            </select>
          </label>

          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="full-width">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>

          <label>
            {taskType === "reward" ? "Gold cost" : "Gold value"}
            <input
              type="number"
              step="0.01"
              min={taskType === "reward" ? 0 : undefined}
              value={taskType === "reward" ? Math.abs(Number(goldDelta) || 0).toString() : goldDelta}
              onChange={(event) => {
                if (taskType === "reward") {
                  const cost = Math.abs(Number(event.target.value) || 0);
                  setGoldDelta((-cost).toString());
                  return;
                }
                setGoldDelta(event.target.value);
              }}
            />
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={isHidden} onChange={(event) => setIsHidden(event.target.checked)} />
            Hidden
          </label>

          <div className="full-width readonly-row">{lastActionText}</div>

          <div className="full-width nested-box">
            <strong>Tags</strong>
            <div className="tag-picker">
              {availableTags.map((tag) => {
                const checked = selectedTagIds.includes(tag.id);
                return (
                  <label key={tag.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedTagIds((prev) =>
                          event.target.checked ? [...prev, tag.id] : prev.filter((id) => id !== tag.id)
                        );
                      }}
                    />
                    {tag.name}
                  </label>
                );
              })}
              {!availableTags.length && <span className="task-meta">No tags for this profile yet.</span>}
            </div>
          </div>

          {taskType === "habit" && (
            <>
              <label>
                Count increment
                <input
                  type="number"
                  step="0.01"
                  value={countIncrement}
                  onChange={(event) => setCountIncrement(event.target.value)}
                />
              </label>
              <label>
                Count reset cadence
                <select value={countResetCadence} onChange={(event) => setCountResetCadence(event.target.value)}>
                  {HABIT_RESET_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {taskType === "daily" && (
            <>
              <label>
                Repeat cadence
                <select value={repeatCadence} onChange={(event) => setRepeatCadence(event.target.value)}>
                  {DAILY_CADENCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Repeat every
                <input
                  type="number"
                  min={1}
                  value={repeatEvery}
                  onChange={(event) => setRepeatEvery(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label>
                Autocomplete threshold (HH:MM:SS)
                <input
                  placeholder="00:30:00"
                  value={autocompleteThreshold}
                  onChange={(event) => setAutocompleteThreshold(event.target.value)}
                />
              </label>
              <div className="full-width nested-box">
                <strong>Streak bonus rules</strong>
                <div className="quick-add">
                  <input
                    type="number"
                    min={1}
                    value={newRuleGoal}
                    onChange={(event) => setNewRuleGoal(Math.max(1, Number(event.target.value) || 1))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={newRuleBonus}
                    onChange={(event) => setNewRuleBonus(event.target.value)}
                  />
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => {
                      setStreakRulesDraft((prev) =>
                        [...prev, { streak_goal: newRuleGoal, bonus_percent: Number(newRuleBonus || 0).toFixed(2) }].sort(
                          (a, b) => a.streak_goal - b.streak_goal
                        )
                      );
                    }}
                  >
                    Add
                  </button>
                </div>
                <ul className="nested-list">
                  {streakRulesDraft.map((rule, index) => (
                    <li key={`${rule.streak_goal}-${index}`}>
                      <span>
                        streak {rule.streak_goal} {"=>"} +{rule.bonus_percent}%
                      </span>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => setStreakRulesDraft((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {taskType === "todo" && (
            <>
              <label>
                Due date
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
              <label>
                Due time
                <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
              </label>
              <div className="full-width nested-box">
                <strong>Checklist</strong>
                <div className="quick-add">
                  <input
                    placeholder="New checklist item"
                    value={newChecklistText}
                    onChange={(event) => setNewChecklistText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && newChecklistText.trim()) {
                        setChecklistDraft((prev) => [...prev, { text: newChecklistText.trim(), is_completed: false }]);
                        setNewChecklistText("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => {
                      if (!newChecklistText.trim()) {
                        return;
                      }
                      setChecklistDraft((prev) => [...prev, { text: newChecklistText.trim(), is_completed: false }]);
                      setNewChecklistText("");
                    }}
                  >
                    Add
                  </button>
                </div>
                <ul className="nested-list">
                  {checklistDraft.map((item, index) => (
                    <li key={`${item.text}-${index}`}>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={item.is_completed}
                          onChange={(event) =>
                            setChecklistDraft((prev) =>
                              prev.map((current, i) => (i === index ? { ...current, is_completed: event.target.checked } : current))
                            )
                          }
                        />
                        <span>{item.text}</span>
                      </label>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => setChecklistDraft((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {taskType === "reward" && (
            <label className="checkbox-row">
              <input type="checkbox" checked={isRepeatable} onChange={(event) => setIsRepeatable(event.target.checked)} />
              Repeatable
            </label>
          )}
        </div>

        {error && <div className="status error">{error}</div>}

        <div className="modal-actions">
          {isEdit && (
            <button type="button" className="danger-button" disabled={isDeleting || isSaving} onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="button" className="action-button" disabled={isSaving || isDeleting} onClick={handleSubmit}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
