import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchLogs } from "../../shared/repositories/client";
import { useProfileContext } from "../profiles/ProfileContext";

export function formatDuration(duration: string | null) {
  if (!duration) {
    return "00:00:00";
  }
  const match = duration.match(/^(\d+):(\d{2}):(\d{2})(\.\d+)?$/);
  if (match) {
    const hours = String(Number(match[1])).padStart(2, "0");
    return `${hours}:${match[2]}:${match[3]}`;
  }
  return duration;
}

export function formatGoldDelta(value: string) {
  return value.startsWith("-") ? value : `+${value}`;
}

export function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatLogLine(log: {
  type: string;
  timestamp: string;
  title_snapshot: string;
  gold_delta: string;
  duration: string | null;
  count_delta: string | null;
}) {
  const when = new Date(log.timestamp).toLocaleString();
  if (log.type === "activity_duration") {
    return `${when} | Spent ${formatDuration(log.duration)} on activity: ${log.title_snapshot || "(no title)"}`;
  }
  if (log.type === "habit_incremented") {
    return `${when} | ${log.title_snapshot || "(no title)"} | count +${log.count_delta ?? "0"} | gold ${formatGoldDelta(log.gold_delta)}`;
  }
  return `${when} | ${log.title_snapshot || "(no title)"} | gold ${formatGoldDelta(log.gold_delta)}`;
}

export function LogsPage() {
  const { profileId } = useProfileContext();
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const [limit, setLimit] = useState<50 | 100 | 200 | 500>(50);
  const [startDate, setStartDate] = useState(formatDateInputValue(sevenDaysAgo));
  const [endDate, setEndDate] = useState(formatDateInputValue(today));

  const logsQuery = useQuery({
    queryKey: ["logs", profileId, limit, startDate, endDate],
    queryFn: () =>
      fetchLogs(profileId, {
        limit,
        from: startDate,
        to: endDate
      }),
    enabled: Boolean(profileId)
  });

  if (!profileId) {
    return <div className="status info">Select a profile first.</div>;
  }

  if (logsQuery.isLoading) {
    return <div className="status info">Loading logs...</div>;
  }

  if (logsQuery.isError) {
    return <div className="status error">Failed to load logs.</div>;
  }

  return (
    <div className="board-layout">
      <h2>Recent Logs</h2>
      <div className="logs-filters">
        <label className="logs-filter-item">
          <span>Show last</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value) as 50 | 100 | 200 | 500)}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <span>entries</span>
        </label>
        <label className="logs-filter-item">
          <span>from</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="logs-filter-item">
          <span>to</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>
      <ul className="task-list">
        {(logsQuery.data ?? []).map((log) => (
          <li key={log.id}>
            <strong>{log.type}</strong>
            <span className="task-meta">{formatLogLine(log)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
