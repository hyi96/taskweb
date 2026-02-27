import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CurrentActivityPanel } from "../features/activity/CurrentActivityPanel";
import { useAuthContext } from "../features/auth/AuthContext";
import { setStorageMode, storageMode } from "../shared/repositories/client";
import { ProfileSelector } from "../features/profiles/ProfileSelector";
import { fetchDailyPhrase } from "../shared/api/site";
import { useTheme } from "./theme";

export function AppShell({ children }: PropsWithChildren) {
  const { isCloudMode, username, logout } = useAuthContext();
  const { mode, setMode } = useTheme();
  const isGuestMode = storageMode === "indexeddb";
  const phraseQuery = useQuery({
    queryKey: ["site", "daily-phrase"],
    queryFn: fetchDailyPhrase,
    staleTime: 60 * 60 * 1000,
  });
  const phraseText = phraseQuery.data?.text ?? "Build your day.";
  const phraseAuthor = phraseQuery.data?.author ?? "Taskweb";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-and-nav">
          <div className="brand">
            <div className="daily-phrase-label">Quote of the day</div>
            <h1 className="daily-phrase-text">"{phraseText}" - {phraseAuthor}</h1>
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
          <div className="session-box">
            <small>Theme</small>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "system" | "light" | "dark")}
            >
              <option value="system">follow system</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </div>
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
      <footer className="app-footnote">
        <a href="https://github.com/hyi96/taskweb" target="_blank" rel="noreferrer">
          github repo
        </a>
      </footer>
    </div>
  );
}
