import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createActivityDurationLog, dailyComplete, queueActivityDurationLog } from "../../shared/repositories/client";
import type { Task } from "../../shared/types/task";
import { useProfileContext } from "../profiles/ProfileContext";

type CurrentActivityTarget = {
  taskId?: string | null;
  rewardId?: string | null;
};

type CurrentActivityContextValue = {
  title: string;
  setTitle: (value: string) => void;
  elapsedSeconds: number;
  isRunning: boolean;
  start: () => void;
  pause: () => Promise<void>;
  reset: () => Promise<void>;
  remove: () => Promise<void>;
  setCurrentActivity: (title: string, target?: CurrentActivityTarget) => Promise<void>;
};

const CurrentActivityContext = createContext<CurrentActivityContextValue | undefined>(undefined);

export function CurrentActivityProvider({ children }: PropsWithChildren) {
  const { profileId } = useProfileContext();
  const queryClient = useQueryClient();
  const previousProfileIdRef = useRef<string>("");
  const unloadFlushedRef = useRef(false);
  const autoCompletedThisRunRef = useRef(false);
  const runStartedAtMsRef = useRef<number | null>(null);
  const elapsedAtRunStartRef = useRef(0);
  const [title, setTitle] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionStartSeconds, setSessionStartSeconds] = useState(0);
  const [target, setTarget] = useState<CurrentActivityTarget>({});

  const getElapsedNow = () => {
    if (!isRunning || runStartedAtMsRef.current === null) {
      return elapsedSeconds;
    }
    const deltaSeconds = Math.max(0, Math.floor((Date.now() - runStartedAtMsRef.current) / 1000));
    return elapsedAtRunStartRef.current + deltaSeconds;
  };

  const parseDurationSeconds = (value: string | null | undefined) => {
    if (!value) {
      return 0;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    const daySplit = trimmed.split(" ");
    let days = 0;
    let timePart = trimmed;
    if (daySplit.length === 2 && /^\d+$/.test(daySplit[0])) {
      days = Number(daySplit[0]);
      timePart = daySplit[1];
    }

    const match = timePart.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!match) {
      return 0;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return days * 24 * 3600 + hours * 3600 + minutes * 60 + seconds;
  };

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const syncElapsed = () => {
      setElapsedSeconds(getElapsedNow());
    };

    syncElapsed();
    const id = window.setInterval(syncElapsed, 1000);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        syncElapsed();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isRunning]);

  useEffect(() => {
    const flushOnUnload = () => {
      if (unloadFlushedRef.current || !isRunning) {
        return;
      }
      const elapsedNow = getElapsedNow();
      const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
      if (!title.trim() || sessionSeconds <= 0 || !profileId) {
        return;
      }
      unloadFlushedRef.current = true;
      queueActivityDurationLog({
        profileId,
        title: title.trim(),
        durationSeconds: sessionSeconds,
        taskId: target.taskId ?? null,
        rewardId: target.rewardId ?? null
      });
    };

    window.addEventListener("pagehide", flushOnUnload);
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      window.removeEventListener("pagehide", flushOnUnload);
      window.removeEventListener("beforeunload", flushOnUnload);
    };
  }, [isRunning, elapsedSeconds, sessionStartSeconds, title, profileId, target]);

  useEffect(() => {
    if (!isRunning || !profileId || !target.taskId || autoCompletedThisRunRef.current) {
      return;
    }

    const tasks = queryClient.getQueryData<Task[]>(["tasks", profileId]) ?? [];
    const currentTask = tasks.find((task) => task.id === target.taskId);
    if (!currentTask || currentTask.task_type !== "daily") {
      return;
    }

    const thresholdSeconds = parseDurationSeconds(currentTask.autocomplete_time_threshold);
    if (thresholdSeconds <= 0) {
      return;
    }

    const sessionSeconds = Math.max(0, getElapsedNow() - sessionStartSeconds);
    if (sessionSeconds < thresholdSeconds) {
      return;
    }

    autoCompletedThisRunRef.current = true;
    void (async () => {
      try {
        await dailyComplete(currentTask.id, profileId);
        void queryClient.invalidateQueries({ queryKey: ["tasks", profileId] });
        void queryClient.invalidateQueries({ queryKey: ["logs", profileId] });
        void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      } catch {
        // Keep timer flow resilient; if completion fails, do not interrupt activity tracking.
      }
    })();
  }, [isRunning, elapsedSeconds, profileId, sessionStartSeconds, target.taskId, queryClient]);

  const logSession = async (targetProfileId: string, durationSeconds: number, titleText: string, logTarget: CurrentActivityTarget) => {
    if (!targetProfileId || !titleText.trim() || durationSeconds <= 0) {
      return;
    }
    await createActivityDurationLog({
      profileId: targetProfileId,
      title: titleText.trim(),
      durationSeconds,
      taskId: logTarget.taskId ?? null,
      rewardId: logTarget.rewardId ?? null
    });
    void queryClient.invalidateQueries({ queryKey: ["logs", targetProfileId] });
  };

  useEffect(() => {
    const previousProfileId = previousProfileIdRef.current;
    previousProfileIdRef.current = profileId;
    if (!previousProfileId || previousProfileId === profileId) {
      return;
    }

    const finalizeSwitch = async () => {
      if (isRunning) {
        const elapsedNow = getElapsedNow();
        const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
        try {
          await logSession(previousProfileId, sessionSeconds, title, target);
        } catch {
          // Do not block profile switch on logging failures.
        }
      }
      setIsRunning(false);
      setElapsedSeconds(0);
      setSessionStartSeconds(0);
      autoCompletedThisRunRef.current = false;
      runStartedAtMsRef.current = null;
      elapsedAtRunStartRef.current = 0;
      setTitle("");
      setTarget({});
    };

    void finalizeSwitch();
  }, [profileId, isRunning, elapsedSeconds, sessionStartSeconds, title, target]);

  const start = () => {
    if (isRunning) {
      return;
    }
    unloadFlushedRef.current = false;
    autoCompletedThisRunRef.current = false;
    elapsedAtRunStartRef.current = elapsedSeconds;
    runStartedAtMsRef.current = Date.now();
    setSessionStartSeconds(elapsedSeconds);
    setIsRunning(true);
  };

  const pause = async () => {
    if (!isRunning) {
      return;
    }
    const elapsedNow = getElapsedNow();
    setIsRunning(false);
    setElapsedSeconds(elapsedNow);
    unloadFlushedRef.current = false;
    autoCompletedThisRunRef.current = false;
    runStartedAtMsRef.current = null;
    elapsedAtRunStartRef.current = 0;
    const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
    try {
      await logSession(profileId, sessionSeconds, title, target);
    } catch {
      // Keep timer controls responsive even when logging fails.
    }
  };

  const reset = async () => {
    if (isRunning) {
      const elapsedNow = getElapsedNow();
      setIsRunning(false);
      setElapsedSeconds(elapsedNow);
      unloadFlushedRef.current = false;
      autoCompletedThisRunRef.current = false;
      runStartedAtMsRef.current = null;
      elapsedAtRunStartRef.current = 0;
      const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep timer controls responsive even when logging fails.
      }
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
    autoCompletedThisRunRef.current = false;
  };

  const remove = async () => {
    if (isRunning) {
      const elapsedNow = getElapsedNow();
      setIsRunning(false);
      setElapsedSeconds(elapsedNow);
      unloadFlushedRef.current = false;
      autoCompletedThisRunRef.current = false;
      runStartedAtMsRef.current = null;
      elapsedAtRunStartRef.current = 0;
      const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep timer controls responsive even when logging fails.
      }
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
    autoCompletedThisRunRef.current = false;
    setTitle("");
    setTarget({});
  };

  const setCurrentActivity = async (nextTitle: string, nextTarget?: CurrentActivityTarget) => {
    if (isRunning) {
      const elapsedNow = getElapsedNow();
      const sessionSeconds = Math.max(0, elapsedNow - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep current-activity switching responsive even when logging fails.
      }
      setIsRunning(false);
      setElapsedSeconds(elapsedNow);
      unloadFlushedRef.current = false;
      autoCompletedThisRunRef.current = false;
      runStartedAtMsRef.current = null;
      elapsedAtRunStartRef.current = 0;
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
    autoCompletedThisRunRef.current = false;
    setTitle(nextTitle ?? "");
    setTarget(nextTarget ?? {});
  };

  const value = {
    title,
    setTitle,
    elapsedSeconds,
    isRunning,
    start,
    pause,
    reset,
    remove,
    setCurrentActivity
  };

  return <CurrentActivityContext.Provider value={value}>{children}</CurrentActivityContext.Provider>;
}

export function useCurrentActivity() {
  const context = useContext(CurrentActivityContext);
  if (!context) {
    throw new Error("useCurrentActivity must be used within CurrentActivityProvider");
  }
  return context;
}
