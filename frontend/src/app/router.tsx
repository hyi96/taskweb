import { Navigate, Route, Routes } from "react-router-dom";
import { GraphsPage } from "../features/graphs/GraphsPage";
import { LogsPage } from "../features/logs/LogsPage";
import { ProfilesPage } from "../features/profiles/ProfilesPage";
import { TaskBoardPage } from "../features/tasks/TaskBoardPage";
import { TagsPage } from "../features/tags/TagsPage";
import { AppShell } from "./shell";

export function AppRouter() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="/tasks" element={<TaskBoardPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/graphs" element={<GraphsPage />} />
      </Routes>
    </AppShell>
  );
}
