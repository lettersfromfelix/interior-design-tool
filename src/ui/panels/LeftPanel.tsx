import { useMemo, useState, type DragEvent } from "react";
import type { CatalogueEntry } from "../../data/catalogue";
import { countIssues } from "../issues";
import { useApp, useAppStore } from "../store";

const ICONS: Record<string, string> = {
  seating: "🛋️",
  table: "🍽️",
  storage: "🗄️",
  bed: "🛏️",
  lighting: "💡",
  decor: "🪴",
  rug: "🧶",
};
export const categoryIcon = (category: string): string => ICONS[category] ?? "📦";
export const categoryLabel = (category: string): string => {
  const s = category.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** MIME type of catalogue cards dragged into the view. */
export const DRAG_TYPE = "application/x-catalogue-item";

function Card({ entry }: { entry: CatalogueEntry }) {
  const store = useAppStore();
  const { item } = entry;
  const thumb = useApp((s) => s.thumbnails[item.id]);
  const active = useApp((s) => s.placing?.itemId === item.id);
  const toggle = () => {
    const s = store.getState();
    if (active) s.stopPlacing();
    else s.startPlacing(item.id, "click");
  };
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, item.id);
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "copy";
    store.getState().startPlacing(item.id, "drag");
  };
  const onDragEnd = () => {
    if (store.getState().placing?.via === "drag") store.getState().stopPlacing();
  };
  const { width, depth, height } = item.dimensions;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={`card ${active ? "card--active" : ""}`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={`${item.name} (${item.id})\nClick, then click into the view to place it, or drag it into the view.${item.notes ? `\n\n${item.notes}` : ""}`}
      aria-pressed={active}
    >
      <span className="card__thumb">
        {thumb ? <img src={thumb.url} alt="" draggable={false} /> : <span className="card__icon">{categoryIcon(item.category)}</span>}
      </span>
      <span className="card__name">{item.name}</span>
      <span className="card__meta">
        {width} × {depth} × {height} cm
      </span>
      {entry.warnings > 0 && (
        <span className="card__badge" title={`${entry.warnings} warning(s), see Issues`}>
          ⚠ {entry.warnings}
        </span>
      )}
    </div>
  );
}

function CatalogueList() {
  const store = useAppStore();
  const catalogue = useApp((s) => s.catalogue);
  const placing = useApp((s) => s.placing);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const entries = useMemo(() => [...catalogue.entries.values()], [catalogue]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.item.category, (counts.get(e.item.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);
  const q = query.trim().toLowerCase();
  const shown = entries
    .filter((e) => !category || e.item.category === category)
    .filter((e) => !q || [e.item.name, e.item.id, e.item.category, ...(e.item.tags ?? [])].some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => a.item.category.localeCompare(b.item.category) || a.item.name.localeCompare(b.item.name));
  const { errors } = countIssues(catalogue.issues);
  const broken = new Set(catalogue.issues.filter((i) => i.severity === "error").map((i) => i.file)).size;

  return (
    <div className="panel catalogue">
      <input className="search" type="search" placeholder="Search furniture" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search furniture" />
      {categories.length > 1 && (
        <div className="chips">
          <button className={`chip ${category === null ? "chip--active" : ""}`} onClick={() => setCategory(null)}>
            All {entries.length}
          </button>
          {categories.map(([c, n]) => (
            <button key={c} className={`chip ${category === c ? "chip--active" : ""}`} onClick={() => setCategory(category === c ? null : c)}>
              {categoryLabel(c)} {n}
            </button>
          ))}
        </div>
      )}
      {errors > 0 && (
        <button className="notice notice--error notice--button" onClick={() => store.getState().setSidePanel("issues")}>
          {broken} catalogue file{broken > 1 ? "s have" : " has"} errors and {broken > 1 ? "are" : "is"} not shown. Open Issues.
        </button>
      )}
      {placing?.via === "click" && <p className="notice">Click into the view to place it. R rotates, Esc cancels.</p>}
      {catalogue.status === "ready" && entries.length === 0 ? (
        <p className="muted">
          The catalogue is empty. Add an item file to <code>catalogue/</code> (see CATALOGUE.md); it appears here automatically.
        </p>
      ) : (
        <div className="cards">
          {shown.map((e) => (
            <Card key={e.item.id} entry={e} />
          ))}
        </div>
      )}
      {entries.length > 0 && shown.length === 0 && <p className="muted">Nothing matches.</p>}
    </div>
  );
}

function PlacedList() {
  const doc = useApp((s) => s.layout.doc);
  const entries = useApp((s) => s.catalogue.entries);
  const thumbnails = useApp((s) => s.thumbnails);
  const selected = useApp((s) => (s.selection?.kind === "item" ? s.selection.uid : null));
  const selectItem = useApp((s) => s.selectItem);
  if (doc.items.length === 0) {
    return (
      <div className="panel">
        <p className="muted">Nothing placed yet. Drag an item from the catalogue into the view, or click it and then click into the view.</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <ul className="placed">
        {doc.items.map((p) => {
          const item = entries.get(p.item)?.item;
          const thumb = thumbnails[p.item];
          return (
            <li key={p.uid}>
              <button className={`placed__row ${selected === p.uid ? "placed__row--active" : ""}`} onClick={() => selectItem(p.uid)}>
                <span className="placed__thumb">{thumb ? <img src={thumb.url} alt="" /> : item ? categoryIcon(item.category) : "⚠"}</span>
                <span className="placed__name">
                  {p.label ?? item?.name ?? `Unknown item "${p.item}"`}
                  <span className="muted"> {p.uid}</span>
                </span>
                <span className="placed__flags">
                  {p.locked && <span title="Locked">🔒</span>}
                  {p.hidden && <span title="Hidden">🙈</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LeftPanel() {
  const panel = useApp((s) => s.leftPanel);
  const setPanel = useApp((s) => s.setLeftPanel);
  const count = useApp((s) => s.catalogue.entries.size);
  const placed = useApp((s) => s.layout.doc.items.length);
  return (
    <aside className="left">
      <nav className="tabs">
        <button className={panel === "catalogue" ? "active" : ""} onClick={() => setPanel("catalogue")}>
          Catalogue <span className="muted">{count}</span>
        </button>
        <button className={panel === "placed" ? "active" : ""} onClick={() => setPanel("placed")}>
          Placed <span className="muted">{placed}</span>
        </button>
      </nav>
      {panel === "catalogue" ? <CatalogueList /> : <PlacedList />}
    </aside>
  );
}
