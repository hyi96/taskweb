import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import { CurrentActivityPanel } from "../features/activity/CurrentActivityPanel";
import { ProfileSelector } from "../features/profiles/ProfileSelector";

export function AppShell({ children }: PropsWithChildren) {
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
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
