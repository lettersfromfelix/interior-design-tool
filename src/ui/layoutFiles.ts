/** The website's Save: download the working layout as a JSON file, formatted like the files in layouts/. */
import { serializeLayout } from "../core/layout/serialize";
import type { LayoutState } from "../state/store";

/** The name the downloaded file gets: the layout's file name, e.g. "inspiration.json". */
export const downloadName = (file: string): string => file.slice(file.lastIndexOf("/") + 1);

export function downloadLayout(layout: Pick<LayoutState, "file" | "doc">): void {
  const text = serializeLayout(layout.doc, new Date().toISOString());
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName(layout.file);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
