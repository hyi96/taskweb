import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLogs } from "../../shared/api/logs";
import { fetchTasks } from "../../shared/api/tasks";
import type { LogEntry } from "../../shared/types/log";
import type { Task } from "../../shared/types/task";
import { useProfileContext } from "../profiles/ProfileContext";

type TimeResolution = "hour" | "day" | "week" | "month" | "year";
type TargetType = "gold" | "habit" | "daily" | "todo" | "reward" | "activity";
type TargetValueKey = "gold_delta" | "user_gold" | "count_delta" | "time_spent" | "completions" | "created" | "completed" | "claims";

type TargetInstance = { id: string | null; name: string; activityTitle?: string };
type SearchOption = { targetType: TargetType; entityId: string | null; activityTitle?: string; name: string };
type Bucket = { start: Date; end: Date; label: string };

const RESOLUTION_OPTIONS: Array<{ value: TimeResolution; label: string }> = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" }
];

const TARGET_TYPE_OPTIONS: Array<{ value: TargetType; label: string }> = [
  { value: "gold", label: "Gold" },
  { value: "habit", label: "Habit" },
  { value: "daily", label: "Daily" },
  { value: "todo", label: "Todo" },
  { value: "reward", label: "Reward" },
  { value: "activity", label: "Activity" }
];

const TARGET_VALUE_OPTIONS: Record<TargetType, Array<{ value: TargetValueKey; label: string }>> = {
  gold: [
    { value: "gold_delta", label: "Change (Gold Delta)" },
    { value: "user_gold", label: "Balance (User Gold)" }
  ],
  habit: [
    { value: "count_delta", label: "Count Change" },
    { value: "time_spent", label: "Total Time Spent (minutes)" }
  ],
  daily: [
    { value: "completions", label: "Completions" },
    { value: "time_spent", label: "Total Time Spent (minutes)" }
  ],
  todo: [
    { value: "created", label: "Created" },
    { value: "completed", label: "Completed" },
    { value: "time_spent", label: "Total Time Spent (minutes)" }
  ],
  reward: [
    { value: "claims", label: "Claims" },
    { value: "time_spent", label: "Total Time Spent (minutes)" }
  ],
  activity: [{ value: "time_spent", label: "Total Time Spent (minutes)" }]
};

function startOfWeekMonday(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (7 + (day - 1)) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function createBuckets(resolution: TimeResolution): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];
  if (resolution === "hour") {
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    for (let i = 71; i >= 0; i -= 1) {
      const start = new Date(currentHour.getTime() - i * 3600_000);
      const end = new Date(start.getTime() + 3600_000);
      buckets.push({ start, end, label: start.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit" }) });
    }
    return buckets;
  }
  if (resolution === "day") {
    const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 13; i >= 0; i -= 1) {
      const start = new Date(currentDay);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      buckets.push({ start, end, label: start.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" }) });
    }
    return buckets;
  }
  if (resolution === "week") {
    const currentWeek = startOfWeekMonday(now);
    for (let i = 7; i >= 0; i -= 1) {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      buckets.push({ start, end, label: start.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" }) });
    }
    return buckets;
  }
  if (resolution === "month") {
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 11; i >= 0; i -= 1) {
      const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      buckets.push({ start, end, label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}` });
    }
    return buckets;
  }
  const currentYear = new Date(now.getFullYear(), 0, 1);
  for (let i = 3; i >= 0; i -= 1) {
    const start = new Date(currentYear.getFullYear() - i, 0, 1);
    const end = new Date(start.getFullYear() + 1, 0, 1);
    buckets.push({ start, end, label: String(start.getFullYear()) });
  }
  return buckets;
}

function bucketIndexFor(ts: Date, buckets: Bucket[]) {
  for (let i = 0; i < buckets.length; i += 1) {
    if (ts >= buckets[i].start && ts < buckets[i].end) {
      return i;
    }
  }
  return -1;
}

function durationToMinutes(duration: string | null) {
  if (!duration) return 0;
  const parts = duration.split(":");
  if (parts.length < 3) return 0;
  const secondsPart = parts[2].split(".")[0];
  const hours = Number(parts[0]) || 0;
  const minutes = Number(parts[1]) || 0;
  const seconds = Number(secondsPart) || 0;
  return hours * 60 + minutes + seconds / 60;
}

function buildSearchOptions(tasks: Task[], logs: LogEntry[]): SearchOption[] {
  const fromTasks = tasks.map((task) => ({
    targetType: task.task_type as TargetType,
    entityId: task.id,
    name: task.title
  }));
  const seen = new Set<string>();
  const activities = logs
    .filter((log) => log.type === "activity_duration" && log.title_snapshot.trim())
    .map((log) => log.title_snapshot.trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({ targetType: "activity" as const, entityId: null, activityTitle: name, name }));
  return [...fromTasks, ...activities];
}

function getInstances(tasks: Task[], logs: LogEntry[], targetType: TargetType): TargetInstance[] {
  if (targetType === "gold") {
    return [{ id: null, name: "All Gold" }];
  }
  if (targetType === "activity") {
    return buildSearchOptions(tasks, logs)
      .filter((x) => x.targetType === "activity")
      .map((x) => ({ id: null, name: x.name, activityTitle: x.activityTitle }));
  }
  return tasks.filter((task) => task.task_type === targetType).map((task) => ({ id: task.id, name: task.title }));
}

function aggregateValues(
  buckets: Bucket[],
  logs: LogEntry[],
  tasks: Task[],
  targetType: TargetType,
  targetValue: TargetValueKey,
  instance: TargetInstance | null
) {
  const values = new Array<number>(buckets.length).fill(0);

  if (targetType === "gold") {
    let lastGold: number | null = null;
    for (let i = 0; i < buckets.length; i += 1) {
      const entries = logs.filter((log) => {
        const ts = new Date(log.timestamp);
        return ts >= buckets[i].start && ts < buckets[i].end;
      });
      if (targetValue === "gold_delta") {
        values[i] = entries.reduce((sum, log) => sum + Number(log.gold_delta || 0), 0);
      } else {
        const latest = entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).at(-1);
        if (latest) lastGold = Number(latest.user_gold || 0);
        values[i] = lastGold ?? Number.NaN;
      }
    }
    return values;
  }

  if (targetType === "todo" && (targetValue === "created" || targetValue === "completed") && instance?.id) {
    const task = tasks.find((t) => t.id === instance.id);
    const keyDate = targetValue === "created" ? task?.created_at : task?.completed_at;
    if (keyDate) {
      const idx = bucketIndexFor(new Date(keyDate), buckets);
      if (idx >= 0) values[idx] = 1;
    }
    return values;
  }

  for (let i = 0; i < buckets.length; i += 1) {
    const bucketEntries = logs.filter((log) => {
      const ts = new Date(log.timestamp);
      if (!(ts >= buckets[i].start && ts < buckets[i].end)) return false;
      if (targetType === "activity") {
        return log.type === "activity_duration" && log.title_snapshot === instance?.activityTitle;
      }
      if (targetType === "reward") {
        return log.reward_id === instance?.id;
      }
      return log.task_id === instance?.id;
    });

    if (targetValue === "count_delta") {
      values[i] = bucketEntries.filter((x) => x.type === "habit_incremented").reduce((sum, x) => sum + Number(x.count_delta || 0), 0);
    } else if (targetValue === "completions") {
      values[i] = bucketEntries.filter((x) => x.type === "daily_completed").length;
    } else if (targetValue === "claims") {
      values[i] = bucketEntries.filter((x) => x.type === "reward_claimed").length;
    } else if (targetValue === "time_spent") {
      values[i] = bucketEntries.filter((x) => x.type === "activity_duration").reduce((sum, x) => sum + durationToMinutes(x.duration), 0);
    }
  }
  return values;
}

function MiniChart({ labels, values }: { labels: string[]; values: number[] }) {
  const width = 920;
  const height = 280;
  const left = 40;
  const bottom = 28;
  const top = 10;
  const innerH = height - top - bottom;
  const innerW = width - left - 10;
  const finiteValues = values.filter((v) => Number.isFinite(v));
  const rawMax = Math.max(0, ...finiteValues);
  const rawMin = Math.min(0, ...finiteValues);
  const targetSteps = 5;
  const rawRange = Math.max(1e-9, rawMax - rawMin);
  const roughStep = rawRange / targetSteps;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  const axisMin = Math.floor(rawMin / step) * step;
  const axisMax = Math.ceil(rawMax / step) * step;
  const range = Math.max(1, axisMax - axisMin);
  const tickValues: number[] = [];
  for (let tick = axisMax; tick >= axisMin; tick -= step) {
    tickValues.push(Number(tick.toFixed(10)));
  }
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  const points = values.map((value, i) => {
    const x = left + (i / Math.max(1, values.length - 1)) * innerW;
    const y = top + ((axisMax - (Number.isFinite(value) ? value : 0)) / range) * innerH;
    return { x, y, value };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="graph-svg" role="img" aria-label="Graph">
      <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#9ab0de" />
      <line x1={left} y1={height - bottom} x2={width - 10} y2={height - bottom} stroke="#9ab0de" />
      {tickValues.map((value, i) => {
        const y = top + ((axisMax - value) / range) * innerH;
        return (
          <g key={`tick-${value}-${i}`}>
            <line x1={left - 4} y1={y} x2={width - 10} y2={y} stroke="#eef2fb" />
            <text x={left - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#5b6477">
              {value.toFixed(decimals)}
            </text>
          </g>
        );
      })}
      <path d={pathD} fill="none" stroke="#4f78d8" strokeWidth="2.5" />
      {points.map((point, i) => (
        <circle key={`${labels[i]}-${i}`} cx={point.x} cy={point.y} r="2.5" fill="#4f78d8">
          <title>{`${labels[i]}: ${Number.isFinite(point.value) ? point.value.toFixed(2) : "0.00"}`}</title>
        </circle>
      ))}
      {labels.map((label, i) => {
        if (labels.length > 20 && i % Math.ceil(labels.length / 10) !== 0) return null;
        const x = left + (i / Math.max(1, labels.length - 1)) * innerW;
        return (
          <text key={`${label}-${i}`} x={x} y={height - 8} textAnchor="middle" fontSize="10" fill="#5b6477">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

export function GraphsPage() {
  const { profileId } = useProfileContext();
  const [resolution, setResolution] = useState<TimeResolution>("day");
  const [targetType, setTargetType] = useState<TargetType>("gold");
  const [targetValue, setTargetValue] = useState<TargetValueKey>("gold_delta");
  const [instanceId, setInstanceId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const tasksQuery = useQuery({
    queryKey: ["tasks", profileId, "graphs"],
    queryFn: () => fetchTasks(profileId),
    enabled: Boolean(profileId)
  });
  const logsQuery = useQuery({
    queryKey: ["logs", profileId, "graphs"],
    queryFn: () => fetchLogs(profileId),
    enabled: Boolean(profileId)
  });

  const tasks = tasksQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  const instances = useMemo(() => getInstances(tasks, logs, targetType), [tasks, logs, targetType]);
  const valueOptions = TARGET_VALUE_OPTIONS[targetType];
  const activeInstance = useMemo(() => {
    if (targetType === "gold") return instances[0] ?? null;
    return instances.find((x) => x.id === instanceId || (targetType === "activity" && x.activityTitle === instanceId)) ?? instances[0] ?? null;
  }, [instances, instanceId, targetType]);

  const searchOptions = useMemo(() => buildSearchOptions(tasks, logs), [tasks, logs]);
  const filteredSearch = useMemo(
    () =>
      searchQuery.trim()
        ? searchOptions.filter((x) => x.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 10)
        : [],
    [searchQuery, searchOptions]
  );

  const { labels, values } = useMemo(() => {
    const buckets = createBuckets(resolution);
    return {
      labels: buckets.map((x) => x.label),
      values: aggregateValues(buckets, logs, tasks, targetType, targetValue, activeInstance)
    };
  }, [resolution, logs, tasks, targetType, targetValue, activeInstance]);

  if (!profileId) return <div className="status info">Select a profile first.</div>;
  if (tasksQuery.isLoading || logsQuery.isLoading) return <div className="status info">Loading graph data...</div>;
  if (tasksQuery.isError || logsQuery.isError) return <div className="status error">Failed to load graph data.</div>;

  return (
    <div className="board-layout">
      <h2>Graphical Insights</h2>
      <div className="graph-res-tabs">
        {RESOLUTION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={resolution === option.value ? "tab active" : "tab"}
            onClick={() => setResolution(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="graph-controls">
        <select
          value={targetType}
          onChange={(event) => {
            const nextType = event.target.value as TargetType;
            setTargetType(nextType);
            const firstValue = TARGET_VALUE_OPTIONS[nextType][0]?.value ?? "time_spent";
            setTargetValue(firstValue);
            setInstanceId("");
          }}
        >
          {TARGET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select value={targetValue} onChange={(event) => setTargetValue(event.target.value as TargetValueKey)}>
          {valueOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select value={targetType === "activity" ? activeInstance?.activityTitle ?? "" : activeInstance?.id ?? ""} onChange={(event) => setInstanceId(event.target.value)}>
          {instances.map((instance) => (
            <option key={`${instance.id ?? "activity"}-${instance.activityTitle ?? instance.name}`} value={targetType === "activity" ? instance.activityTitle : instance.id ?? ""}>
              {instance.name}
            </option>
          ))}
        </select>
      </div>

      <div className="graph-search">
        <input placeholder="Search target instance..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        {filteredSearch.length > 0 && (
          <ul className="graph-search-results">
            {filteredSearch.map((result) => (
              <li key={`${result.targetType}-${result.entityId ?? result.activityTitle}`} onClick={() => {
                setTargetType(result.targetType);
                setTargetValue(TARGET_VALUE_OPTIONS[result.targetType][0].value);
                setInstanceId(result.entityId ?? result.activityTitle ?? "");
                setSearchQuery(result.name);
              }}>
                {result.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="graph-card">
        <MiniChart labels={labels} values={values} />
      </div>
    </div>
  );
}
