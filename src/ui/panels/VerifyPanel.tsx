import { useMemo } from "react";
import { groupUncertain, uncertainValues } from "../../core/apartment/elements";
import { formatCheckValue } from "../../core/format";
import type { Check } from "../../core/schema/apartment";
import { ConfidenceBadge } from "../components";
import { useApp } from "../store";

function CheckRow({ check }: { check: Check }) {
  const active = useApp((s) => s.activeCheck === check.id);
  const setActiveCheck = useApp((s) => s.setActiveCheck);
  const select = useApp((s) => s.selectElement);
  return (
    <li className={`check ${active ? "check--active" : ""}`}>
      <button className="check__head" onClick={() => setActiveCheck(active ? null : check.id)} aria-expanded={active}>
        <span className="check__id">{check.id}</span>
        <span className="check__title">{check.title}</span>
        <span className="check__value">{check.planValue ? formatCheckValue(check.planValue, check.unit) : "–"}</span>
      </button>
      {active && (
        <div className="check__body">
          <p>{check.how}</p>
          {check.measured !== undefined && (
            <p>
              Measured: <b>{formatCheckValue(check.measured, check.unit)}</b>
            </p>
          )}
          {!!check.refs?.length && (
            <div className="chips">
              {check.refs.map((id) => (
                <button key={id} className="chip" onClick={() => select(id)}>
                  {id}
                </button>
              ))}
            </div>
          )}
          {!check.from && <p className="muted">No dimension line for this item.</p>}
        </div>
      )}
    </li>
  );
}

export function VerifyPanel() {
  const ap = useApp((s) => s.data.apartment);
  const areaChecks = useApp((s) => s.data.areaChecks);
  const select = useApp((s) => s.selectElement);
  const uncertain = useMemo(() => (ap ? groupUncertain(uncertainValues(ap)) : []), [ap]);
  if (!ap) return null;
  const checks = ap.checks ?? [];
  const valueCount = uncertain.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="panel">
      <section>
        <h3>How to verify the apartment</h3>
        <ol className="steps">
          <li>
            In <b>2D</b>, turn on <b>Plan underlay</b>. Walls, doors and windows should sit exactly on the lines of the original plan.
          </li>
          <li>Room areas are compared with the areas printed on the plan (tolerance ±1.5 %).</li>
          <li>
            Measure the checklist items on site. Click an item to see exactly what to measure. Send the numbers to GHCP, who updates{" "}
            <code>data/apartment.json</code>. The same list is in <code>docs/measurement-checklist.md</code>.
          </li>
        </ol>
      </section>

      <section>
        <h3>Room areas</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Model</th>
              <th>Plan</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {areaChecks.map((a) => (
              <tr key={a.room} onClick={() => select(a.room)} className="clickable">
                <td>{a.name}</td>
                <td>{a.computed.toFixed(2)} m²</td>
                <td>{a.labelled} m²</td>
                <td className={a.ok ? "ok" : "warn"}>
                  {a.ok ? "✓" : "⚠"} {(a.deviation * 100).toFixed(1)} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(["must", "nice"] as const).map((priority) => (
        <section key={priority}>
          <h3>{priority === "must" ? "Tape-measure checklist" : "Nice to have"}</h3>
          <ul className="checks">
            {checks
              .filter((c) => c.priority === priority)
              .map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
          </ul>
        </section>
      ))}

      <section>
        <h3>Uncertain values ({valueCount})</h3>
        <p className="muted">Derived or estimated, not read directly from the plan. Click an element to show it.</p>
        <ul className="uncertain">
          {uncertain.map((g) => (
            <li key={`${g.confidence}/${g.field ?? ""}/${g.source}/${g.note ?? ""}`}>
              <div className="uncertain__head">
                <ConfidenceBadge value={g.confidence} />
                <span>
                  <b>{g.field ?? "whole element"}</b> <span className="muted">({g.source})</span>
                  {g.note && <span className="uncertain__note">{g.note}</span>}
                </span>
              </div>
              <div className="chips">
                {g.items.map((it) => (
                  <button key={it.id} className="chip" onClick={() => select(it.id)} title={it.title}>
                    {it.id}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
