import { Icon } from "../lib/icons";
import type { SeedJobStatus } from "../lib/pg";

export function SeedBar({ job, onCancel, onDismiss }: { job: SeedJobStatus; onCancel: () => void; onDismiss: () => void }) {
  const pct = job.overallTotal > 0 ? Math.min(100, Math.round((job.overallDone / job.overallTotal) * 100)) : 0;
  const running = job.status === "running";
  const skippedCount = job.result?.skipped.length || 0;

  const title = running ? "Seeding dummy data…"
    : job.status === "done" ? "Seeding complete"
    : job.status === "cancelled" ? "Seeding cancelled"
    : "Seeding failed";

  return (
    <div className={"seed-bar" + (job.status === "error" ? " err" : "")}>
      <span className="seed-bar-ic">
        {running ? <Icon name="loader" size={15} className="spin" /> : job.status === "error" ? <Icon name="plug" size={15} /> : <Icon name="check" size={15} />}
      </span>
      <div className="seed-bar-body">
        <div className="seed-bar-title">
          {title}
          {running && job.currentTable && <span className="seed-bar-table mono"> · {job.currentTable}</span>}
        </div>
        <div className="seed-bar-track"><div className="seed-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="seed-bar-stats mono">
        {job.overallTotal > 0 && <span>{job.overallDone} / {job.overallTotal} rows</span>}
        {!running && skippedCount > 0 && <span className="seed-bar-skip"> · {skippedCount} skipped</span>}
        {job.error && <span className="seed-bar-skip"> · {job.error}</span>}
      </div>
      <button className="seed-bar-x" title={running ? "Cancel" : "Dismiss"} onClick={running ? onCancel : onDismiss}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
