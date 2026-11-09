import { useMemo } from "react";
import type { Issue } from "../core/validate/issues";
import { checkLayout } from "../core/validate/layout";
import { useApp } from "./store";

/** Every problem the app knows about: data files, catalogue, 3D models, the layout file and its placed items. */
export function useAllIssues(): Issue[] {
  const data = useApp((s) => s.data);
  const catalogue = useApp((s) => s.catalogue);
  const runtime = useApp((s) => s.runtimeIssues);
  const layout = useApp((s) => s.layout);
  return useMemo(() => {
    const files = new Set([...catalogue.entries.values()].map((e) => e.file));
    const models = Object.entries(runtime)
      .filter(([file]) => files.has(file))
      .flatMap(([, list]) => list);
    const placed =
      layout.status === "ready" && catalogue.status === "ready"
        ? checkLayout(layout.doc, layout.file, (id) => catalogue.entries.get(id)?.item, data.materials, data.apartment)
        : [];
    return [...data.issues, ...catalogue.issues, ...models, ...layout.issues, ...placed];
  }, [data, catalogue, runtime, layout]);
}

export function countIssues(issues: readonly Issue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
