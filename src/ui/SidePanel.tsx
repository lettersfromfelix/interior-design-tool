import type { SidePanel as PanelId } from "../state/store";
import { countIssues, useAllIssues } from "./issues";
import { InspectPanel } from "./panels/InspectPanel";
import { IssuesPanel } from "./panels/IssuesPanel";
import { VerifyPanel } from "./panels/VerifyPanel";
import { useApp } from "./store";

const TABS: { id: PanelId; label: string }[] = [
  { id: "verify", label: "Verify" },
  { id: "inspect", label: "Inspect" },
  { id: "issues", label: "Issues" },
];

export function SidePanel() {
  const panel = useApp((s) => s.sidePanel);
  const setPanel = useApp((s) => s.setSidePanel);
  const loadError = useApp((s) => !!s.data.loadError);
  const counts = countIssues(useAllIssues());
  const errors = counts.errors + (loadError ? 1 : 0);
  const total = errors + counts.warnings;
  return (
    <aside className="side">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={panel === t.id ? "active" : ""} onClick={() => setPanel(t.id)}>
            {t.label}
            {t.id === "issues" && total > 0 && <span className={`count ${errors ? "count--error" : "count--warning"}`}>{total}</span>}
          </button>
        ))}
      </nav>
      {panel === "verify" && <VerifyPanel />}
      {panel === "inspect" && <InspectPanel />}
      {panel === "issues" && <IssuesPanel />}
    </aside>
  );
}
