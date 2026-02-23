import { FormEvent, useState } from "react";
import { ApiError } from "../../shared/api/client";
import { setStorageMode } from "../../shared/repositories/client";
import { useAuthContext } from "./AuthContext";

function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const payload = error.payload as Record<string, unknown>;
    const username = payload.username;
    const password = payload.password;
    const passwordConfirm = payload.password_confirm;
    const nonField = payload.non_field_errors;
    if (Array.isArray(nonField) && typeof nonField[0] === "string") {
      return nonField[0];
    }
    if (Array.isArray(username) && typeof username[0] === "string") {
      return username[0];
    }
    if (Array.isArray(password) && typeof password[0] === "string") {
      return password[0];
    }
    if (Array.isArray(passwordConfirm) && typeof passwordConfirm[0] === "string") {
      return passwordConfirm[0];
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Authentication failed.";
}

export function LoginPage() {
  const { login, signup } = useAuthContext();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      if (mode === "signup") {
        await signup(username.trim(), password, passwordConfirm);
      } else {
        await login(username.trim(), password);
      }
      setPassword("");
      setPasswordConfirm("");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const useGuestMode = () => {
    setStorageMode("indexeddb");
    window.location.reload();
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h2>{mode === "signup" ? "Cloud Sign Up" : "Cloud Sign In"}</h2>
        <p>
          {mode === "signup"
            ? "Create a Django account for cloud storage mode."
            : "Sign in with your Django account to use API storage mode."}
        </p>
        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === "login" ? "tab active" : "tab"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
            disabled={isSubmitting}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "tab active" : "tab"}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
            disabled={isSubmitting}
          >
            Sign up
          </button>
        </div>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {mode === "signup" ? (
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                required
              />
            </label>
          ) : null}
          {error ? <div className="status error">{error}</div> : null}
          <button type="submit" className="action-button" disabled={isSubmitting}>
            {isSubmitting ? (mode === "signup" ? "Creating account..." : "Signing in...") : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <button type="button" className="ghost-button" onClick={useGuestMode} disabled={isSubmitting}>
            Use as guest
          </button>
        </form>
      </div>
    </div>
  );
}
