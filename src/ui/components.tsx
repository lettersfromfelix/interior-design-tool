import type { Confidence } from "../core/schema/common";
import type { MaterialPreset } from "../core/schema/materials";
import type { Issue } from "../core/validate/issues";

/** A round swatch's background for a material preset. */
export function swatchStyle(p: MaterialPreset | undefined): React.CSSProperties {
  if (!p) return { background: "#9a9a9a" };
  if (p.pattern) return { background: `linear-gradient(135deg, ${p.color} 0 55%, ${p.pattern.color2} 55% 100%)` };
  if ((p.metalness ?? 0) > 0.5) return { background: `linear-gradient(135deg, ${p.color} 0 40%, #ffffff 60%, ${p.color} 80%)` };
  return { background: p.color };
}

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
