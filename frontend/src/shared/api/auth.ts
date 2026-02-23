import { apiRequest } from "./client";

export type SessionStatus = {
  authenticated: boolean;
  user_id: string | null;
  username: string | null;
};

export async function ensureCsrfCookie(): Promise<void> {
  await apiRequest("/api/auth/csrf/");
}

export async function fetchSessionStatus(): Promise<SessionStatus> {
  return apiRequest<SessionStatus>("/api/auth/session/");
}

export async function loginWithPassword(username: string, password: string): Promise<SessionStatus> {
  await ensureCsrfCookie();
  return apiRequest<SessionStatus>("/api/auth/login/", {
    method: "POST",
    body: { username, password }
  });
}

export async function signUpWithPassword(
  username: string,
  password: string,
  passwordConfirm: string
): Promise<SessionStatus> {
  await ensureCsrfCookie();
  return apiRequest<SessionStatus>("/api/auth/signup/", {
    method: "POST",
    body: { username, password, password_confirm: passwordConfirm }
  });
}

export async function logoutSession(): Promise<SessionStatus> {
  return apiRequest<SessionStatus>("/api/auth/logout/", {
    method: "POST",
    body: {}
  });
}
