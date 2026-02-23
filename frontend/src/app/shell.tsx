import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import { CurrentActivityPanel } from "../features/activity/CurrentActivityPanel";
import { useAuthContext } from "../features/auth/AuthContext";
import { setStorageMode, storageMode } from "../shared/repositories/client";
import { ProfileSelector } from "../features/profiles/ProfileSelector";

export function AppShell({ children }: PropsWithChildren) {
  const { isCloudMode, username, logout } = useAuthContext();
  const isGuestMode = storageMode === "indexeddb";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-and-nav">
          <div className="brand">
            <h1>Taskweb</h1>
          </div>
          <nav className="top-nav">
            <NavLink to="/tasks">Tasks</NavLink>
            <NavLink to="/profiles">Profiles</NavLink>
            <NavLink to="/tags">Tags</NavLink>
            <NavLink to="/logs">Logs</NavLink>
            <NavLink to="/graphs">Graphs</NavLink>
          </nav>
        </div>
        <div className="header-controls">
          <CurrentActivityPanel />
          <ProfileSelector />
          {isCloudMode ? (
            <div className="session-box">
              <small>Signed in as {username ?? "unknown"}</small>
              <button type="button" className="ghost-button" onClick={() => void logout()}>
                Logout
              </button>
            </div>
          ) : null}
          {isGuestMode ? (
            <div className="session-box">
              <small>Guest mode (local storage)</small>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setStorageMode("api");
                  window.location.reload();
                }}
              >
                Use cloud storage
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
