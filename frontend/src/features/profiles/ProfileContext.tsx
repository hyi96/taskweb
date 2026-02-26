import { useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuthContext } from "../auth/AuthContext";
import { fetchProfiles, storageMode } from "../../shared/repositories/client";
import type { Profile } from "../../shared/types/profile";

const STORAGE_KEY = "taskweb.profile_id";

type ProfileContextValue = {
  profileId: string;
  setProfileId: (next: string) => void;
  profiles: Profile[];
  activeProfile: Profile | null;
  isProfilesLoading: boolean;
  refreshProfiles: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

function readStoredProfileId() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, isCloudMode } = useAuthContext();
  const [profileId, setProfileIdState] = useState<string>(readStoredProfileId);

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
    enabled: storageMode === "indexeddb" || (isCloudMode && isAuthenticated)
  });

  const setProfileId = (next: string) => {
    const trimmed = next.trim();
    setProfileIdState(trimmed);
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  };

  const refreshProfiles = async () => {
    await profilesQuery.refetch();
  };

  const profiles = profilesQuery.data ?? [];
  const activeProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  useEffect(() => {
    if (profilesQuery.isLoading) {
      return;
    }

    const hasProfiles = profiles.length > 0;
    const isCurrentValid = profileId ? profiles.some((profile) => profile.id === profileId) : false;
    const fallbackId = hasProfiles ? profiles[0].id : "";

    if (!isCurrentValid && profileId !== fallbackId) {
      setProfileIdState(fallbackId);
      window.localStorage.setItem(STORAGE_KEY, fallbackId);
    }
  }, [profilesQuery.isLoading, profiles, profileId]);

  const value = useMemo(
    () => ({
      profileId,
      setProfileId,
      profiles,
      activeProfile,
      isProfilesLoading: profilesQuery.isLoading,
      refreshProfiles
    }),
    [profileId, profiles, activeProfile, profilesQuery.isLoading]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfileContext() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfileContext must be used within ProfileProvider");
  }
  return context;
}
