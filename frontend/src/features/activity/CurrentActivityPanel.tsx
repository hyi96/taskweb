import { useCurrentActivity } from "./CurrentActivityContext";

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function CurrentActivityPanel() {
  const { title, setTitle, elapsedSeconds, isRunning, start, pause, reset, remove } = useCurrentActivity();
  const startLabel = !isRunning && elapsedSeconds > 0 ? "Resume" : "Start";

  return (
    <div className="activity-panel">
      <div className="activity-panel-head">
        <strong>Current Activity</strong>
        <span className="activity-time">{formatElapsed(elapsedSeconds)}</span>
      </div>
      <input
        className="activity-title-input"
        placeholder="Activity title..."
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="activity-actions">
        <button type="button" className="action-button" disabled={isRunning} onClick={start}>
          {startLabel}
        </button>
        <button type="button" className="action-button" disabled={!isRunning} onClick={() => void pause()}>
          Pause
        </button>
        <button type="button" className="ghost-button" onClick={() => void reset()}>
          Reset
        </button>
        <button type="button" className="danger-button" onClick={() => void remove()}>
          Remove
        </button>
      </div>
    </div>
  );
}
