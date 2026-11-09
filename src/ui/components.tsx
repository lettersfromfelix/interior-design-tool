import type { Confidence } from "../core/schema/common";
import type { Issue } from "../core/validate/issues";

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return <span className={`badge badge--${value}`}>{value}</span>;
}

const severityIcon: Record<Issue["severity"], string> = { error: "✖", warning: "⚠", info: "ℹ" };

export function IssueLine({ issue, showFile = true }: { issue: Issue; showFile?: boolean }) {
  return (
    <li className={`issue issue--${issue.severity}`}>
      <span className="issue__icon" aria-label={issue.severity}>
        {severityIcon[issue.severity]}
      </span>
      <div>
        {(showFile || issue.path) && (
          <div className="issue__where">
            {showFile && issue.file}
            {showFile && issue.path && " › "}
            {issue.path}
          </div>
        )}
        <div>{issue.message}</div>
        {issue.hint && <div className="muted">{issue.hint}</div>}
      </div>
    </li>
  );
}
