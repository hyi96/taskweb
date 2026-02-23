import {
  createProfile,
  deleteProfile,
  exportProfileTaskApp,
  fetchProfiles,
  importProfileTaskApp,
} from "../api/profiles";
import {
  createTask,
  dailyComplete,
  deleteTask,
  fetchTasks,
  habitIncrement,
  rewardClaim,
  todoComplete,
  updateTask,
} from "../api/tasks";
import { createTag, deleteTag, fetchTags, updateTag } from "../api/tags";
import { fetchLogs } from "../api/logs";
import { fetchChecklistItems, replaceChecklistItems } from "../api/checklist";
import { fetchStreakRules, replaceStreakRules } from "../api/streakRules";
import { createActivityDurationLog, queueActivityDurationLog } from "../api/activity";
import { fetchNewDayPreview, startNewDay } from "../api/newDay";
import type { TaskwebRepositories } from "./types";

export const apiRepository: TaskwebRepositories = {
  profiles: {
    fetchAll: fetchProfiles,
    create: createProfile,
    delete: deleteProfile,
    exportTaskApp: exportProfileTaskApp,
    importTaskApp: importProfileTaskApp,
  },
  tasks: {
    fetchAll: fetchTasks,
    create: createTask,
    update: updateTask,
    delete: deleteTask,
    habitIncrement,
    dailyComplete,
    todoComplete,
    rewardClaim,
  },
  tags: {
    fetchAll: fetchTags,
    create: createTag,
    update: updateTag,
    delete: deleteTag,
  },
  logs: {
    fetch: fetchLogs,
  },
  checklist: {
    fetch: fetchChecklistItems,
    replace: replaceChecklistItems,
  },
  streakRules: {
    fetch: fetchStreakRules,
    replace: replaceStreakRules,
  },
  activity: {
    createDurationLog: createActivityDurationLog,
    queueDurationLog: queueActivityDurationLog,
  },
  newDay: {
    preview: fetchNewDayPreview,
    start: startNewDay,
  },
};
