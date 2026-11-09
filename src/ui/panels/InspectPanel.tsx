import { checksFor, elementFacts, elementTitle, findElement } from "../../core/apartment/elements";
import { ConfidenceBadge } from "../components";
import { useApp } from "../store";

export function InspectPanel() {
  const ap = useApp((s) => s.data.apartment);
  const id = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const setActiveCheck = useApp((s) => s.setActiveCheck);
  const ref = ap && id ? findElement(ap, id) : undefined;
  if (!ap || !ref) {
    return (
      <div className="panel">
        <p className="muted">Click a room, wall, door, window or fixture in the view to see its data and how certain it is.</p>
      </div>
    );
  }
  const p = ref.element.provenance;
  const checks = checksFor(ap, ref.element.id);
  return (
    <div className="panel">
      <section>
        <div className="inspect__head">
          <h3>{elementTitle(ref)}</h3>
          <button className="link" onClick={() => select(null)}>
            Clear
          </button>
        </div>
        <div className="muted">
          {ref.kind} · <code>{ref.element.id}</code>
        </div>
        <table className="table table--facts">
          <tbody>
            {elementFacts(ap, ref).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Provenance</h3>
        <p>
          <ConfidenceBadge value={p.confidence} /> from <b>{p.source}</b>
        </p>
        {p.note && <p className="muted">{p.note}</p>}
        {p.fields && (
          <table className="table">
            <tbody>
              {Object.entries(p.fields).map(([field, f]) => (
                <tr key={field}>
                  <th>{field}</th>
                  <td>
                    <ConfidenceBadge value={f.confidence} /> {f.source}
                    {f.note && <div className="muted">{f.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {checks.length > 0 && (
        <section>
          <h3>Checklist items</h3>
          <div className="chips">
            {checks.map((c) => (
              <button key={c.id} className="chip" onClick={() => setActiveCheck(c.id)} title={c.title}>
                {c.id} · {c.title}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <details>
          <summary>Raw data</summary>
          <pre className="raw">{JSON.stringify(ref.element, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
