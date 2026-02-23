import { apiRepository } from "./apiRepository";
import indexeddbRepository from "./indexeddbRepository";
import type { TaskwebRepositories } from "./types";

export type StorageMode = "api" | "indexeddb";

const STORAGE_MODE_OVERRIDE_KEY = "taskweb.storage_mode";

function normalizeStorageMode(value: string | null | undefined): StorageMode | null {
  const normalized = (value ?? "").toString().trim().toLowerCase();
  if (normalized === "api" || normalized === "indexeddb") {
    return normalized;
  }
  return null;
}

function readModeOverride(): StorageMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  return normalizeStorageMode(window.localStorage.getItem(STORAGE_MODE_OVERRIDE_KEY));
}

const envMode = normalizeStorageMode(import.meta.env.VITE_STORAGE_MODE) ?? "api";
export const storageMode: StorageMode = readModeOverride() ?? envMode;

export function setStorageMode(next: StorageMode) {
  if (typeof window === "undefined") {
    return;
  }
  if (next === envMode) {
    window.localStorage.removeItem(STORAGE_MODE_OVERRIDE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_MODE_OVERRIDE_KEY, next);
}

export function getRepositories(): TaskwebRepositories {
  if (storageMode === "indexeddb") {
    return indexeddbRepository;
  }
  return apiRepository;
}
