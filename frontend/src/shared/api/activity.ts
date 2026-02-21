import { apiRequest } from "./client";

type CreateActivityDurationInput = {
  profileId: string;
  title: string;
  durationSeconds: number;
  taskId?: string | null;
  rewardId?: string | null;
};

function toDurationString(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export async function createActivityDurationLog(input: CreateActivityDurationInput): Promise<void> {
  await apiRequest("/api/activity-duration/", {
    method: "POST",
    body: {
      profile_id: input.profileId,
      title: input.title,
      duration: toDurationString(input.durationSeconds),
      ...(input.taskId ? { task_id: input.taskId } : {}),
      ...(input.rewardId ? { reward_id: input.rewardId } : {})
    }
  });
}

function getCookie(name: string) {
  if (typeof document === "undefined") {
    return "";
  }
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() ?? "";
  }
  return "";
}

function buildUrl(path: string) {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").trim() || window.location.origin;
  return new URL(path, base).toString();
}

export function queueActivityDurationLog(input: CreateActivityDurationInput): void {
  if (!input.profileId || !input.title.trim() || input.durationSeconds <= 0) {
    return;
  }
  const csrfToken = getCookie("csrftoken");
  void fetch(buildUrl("/api/activity-duration/"), {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": csrfToken } : {})
    },
    body: JSON.stringify({
      profile_id: input.profileId,
      title: input.title,
      duration: toDurationString(input.durationSeconds),
      ...(input.taskId ? { task_id: input.taskId } : {}),
      ...(input.rewardId ? { reward_id: input.rewardId } : {})
    })
  });
}
