import type { SidePanel as PanelId } from "../state/store";
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
  const errors = useApp((s) => s.data.issues.filter((i) => i.severity === "error").length + (s.data.loadError ? 1 : 0));
  const warnings = useApp((s) => s.data.issues.filter((i) => i.severity === "warning").length);
  return (
    <aside className="side">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={panel === t.id ? "active" : ""} onClick={() => setPanel(t.id)}>
            {t.label}
            {t.id === "issues" && errors + warnings > 0 && (
              <span className={`count ${errors ? "count--error" : "count--warning"}`}>{errors + warnings}</span>
            )}
          </button>
        ))}
      </nav>
      {panel === "verify" && <VerifyPanel />}
      {panel === "inspect" && <InspectPanel />}
      {panel === "issues" && <IssuesPanel />}
    </aside>
  );
}
