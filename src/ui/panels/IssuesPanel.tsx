import type { Issue } from "../../core/validate/issues";
import { isWebsite } from "../../data/backend";
import { IssueLine } from "../components";
import { countIssues, useAllIssues } from "../issues";
import { useApp } from "../store";

function groupByFile(issues: readonly Issue[]): [string, Issue[]][] {
  const groups = new Map<string, Issue[]>();
  for (const i of issues) groups.set(i.file, [...(groups.get(i.file) ?? []), i]);
  return [...groups.entries()];
}

export function IssuesPanel() {
  const issues = useAllIssues();
  const loadError = useApp((s) => s.data.loadError);
  return (
    <div className="panel">
      {loadError && (
        <ul className="issues">
          <IssueLine issue={{ severity: "error", file: isWebsite ? "website" : "file API", path: "", message: loadError }} />
        </ul>
      )}
      {issues.length === 0 && !loadError ? (
        <p className="muted">
          No problems found in the data files, the catalogue or the layout.
          {isWebsite ? " The layout is checked again after every change." : " They are checked again whenever a file changes on disk."}
        </p>
      ) : (
        groupByFile(issues).map(([file, list]) => {
          const { errors, warnings } = countIssues(list);
          return (
            <section key={file}>
              <h3 className="issues__file">
                <code>{file}</code>
                <span className="muted">
                  {errors > 0 && `${errors} error${errors > 1 ? "s" : ""}`}
                  {errors > 0 && warnings > 0 && ", "}
                  {warnings > 0 && `${warnings} warning${warnings > 1 ? "s" : ""}`}
                </span>
              </h3>
              <ul className="issues">
                {list.map((i, n) => (
                  <IssueLine key={`${i.path}/${n}`} issue={i} showFile={false} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
