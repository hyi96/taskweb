import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createActivityDurationLog, queueActivityDurationLog } from "../../shared/repositories/client";
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
  const [title, setTitle] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionStartSeconds, setSessionStartSeconds] = useState(0);
  const [target, setTarget] = useState<CurrentActivityTarget>({});

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const id = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    const flushOnUnload = () => {
      if (unloadFlushedRef.current || !isRunning) {
        return;
      }
      const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
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
        const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
        try {
          await logSession(previousProfileId, sessionSeconds, title, target);
        } catch {
          // Do not block profile switch on logging failures.
        }
      }
      setIsRunning(false);
      setElapsedSeconds(0);
      setSessionStartSeconds(0);
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
    setSessionStartSeconds(elapsedSeconds);
    setIsRunning(true);
  };

  const pause = async () => {
    if (!isRunning) {
      return;
    }
    setIsRunning(false);
    unloadFlushedRef.current = false;
    const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
    try {
      await logSession(profileId, sessionSeconds, title, target);
    } catch {
      // Keep timer controls responsive even when logging fails.
    }
  };

  const reset = async () => {
    if (isRunning) {
      setIsRunning(false);
      unloadFlushedRef.current = false;
      const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep timer controls responsive even when logging fails.
      }
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
  };

  const remove = async () => {
    if (isRunning) {
      setIsRunning(false);
      unloadFlushedRef.current = false;
      const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep timer controls responsive even when logging fails.
      }
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
    setTitle("");
    setTarget({});
  };

  const setCurrentActivity = async (nextTitle: string, nextTarget?: CurrentActivityTarget) => {
    if (isRunning) {
      const sessionSeconds = Math.max(0, elapsedSeconds - sessionStartSeconds);
      try {
        await logSession(profileId, sessionSeconds, title, target);
      } catch {
        // Keep current-activity switching responsive even when logging fails.
      }
      setIsRunning(false);
      unloadFlushedRef.current = false;
    }
    setElapsedSeconds(0);
    setSessionStartSeconds(0);
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
