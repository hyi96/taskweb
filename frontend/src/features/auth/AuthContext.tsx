import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo } from "react";
import { fetchSessionStatus, loginWithPassword, logoutSession, signUpWithPassword, type SessionStatus } from "../../shared/api/auth";
import { storageMode } from "../../shared/repositories/client";

type AuthContextValue = {
  isCloudMode: boolean;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, passwordConfirm: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LOCAL_SESSION: SessionStatus = {
  authenticated: true,
  user_id: "local",
  username: "local"
};

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const isCloudMode = storageMode === "api";

  const sessionQuery = useQuery({
    queryKey: ["auth", "session", storageMode],
    queryFn: fetchSessionStatus,
    enabled: isCloudMode,
    retry: false,
    staleTime: 15_000
  });

  const session = isCloudMode ? sessionQuery.data : LOCAL_SESSION;
  const isAuthenticated = Boolean(session?.authenticated);
  const username = session?.username ?? null;

  const refreshSession = async () => {
    if (!isCloudMode) {
      return;
    }
    await sessionQuery.refetch();
  };

  const login = async (usernameInput: string, password: string) => {
    if (!isCloudMode) {
      return;
    }
    await loginWithPassword(usernameInput, password);
    await queryClient.invalidateQueries({ queryKey: ["auth", "session", storageMode] });
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const logout = async () => {
    if (!isCloudMode) {
      return;
    }
    await logoutSession();
    await queryClient.invalidateQueries({ queryKey: ["auth", "session", storageMode] });
    queryClient.removeQueries({ queryKey: ["profiles"] });
    queryClient.removeQueries({ queryKey: ["tasks"] });
    queryClient.removeQueries({ queryKey: ["logs"] });
    queryClient.removeQueries({ queryKey: ["tags"] });
  };

  const signup = async (usernameInput: string, password: string, passwordConfirm: string) => {
    if (!isCloudMode) {
      return;
    }
    await signUpWithPassword(usernameInput, password, passwordConfirm);
    await queryClient.invalidateQueries({ queryKey: ["auth", "session", storageMode] });
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const value = useMemo(
    () => ({
      isCloudMode,
      isAuthenticated,
      isAuthLoading: isCloudMode ? sessionQuery.isLoading : false,
      username,
      login,
      signup,
      logout,
      refreshSession
    }),
    [isCloudMode, isAuthenticated, sessionQuery.isLoading, username]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
