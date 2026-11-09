import { IssueLine } from "../components";
import { useApp } from "../store";

export function IssuesPanel() {
  const issues = useApp((s) => s.data.issues);
  const loadError = useApp((s) => s.data.loadError);
  return (
    <div className="panel">
      {loadError && (
        <ul className="issues">
          <IssueLine issue={{ severity: "error", file: "file API", path: "", message: loadError }} />
        </ul>
      )}
      {issues.length === 0 && !loadError ? (
        <p className="muted">No problems found in the data files. They are checked again whenever a file changes on disk.</p>
      ) : (
        <ul className="issues">
          {issues.map((i, n) => (
            <IssueLine key={`${i.file}/${i.path}/${n}`} issue={i} />
          ))}
        </ul>
      )}
    </div>
  );
}
