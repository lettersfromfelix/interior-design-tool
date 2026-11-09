/** A problem found while loading a data file. Errors skip the element/file, warnings don't. */
export interface Issue {
  severity: "error" | "warning" | "info";
  /** Repository-relative file path, e.g. "catalogue/sofa.json". */
  file: string;
  /** Property path inside the file, e.g. "openings[3].width" ("" = whole file). */
  path: string;
  message: string;
  hint?: string;
}

export type PathSegment = string | number | symbol;

export function formatPath(path: readonly PathSegment[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

export function issue(
  severity: Issue["severity"],
  file: string,
  path: string,
  message: string,
  hint?: string,
): Issue {
  return hint ? { severity, file, path, message, hint } : { severity, file, path, message };
}

/** Parse JSON and report syntax errors with line and column. */
export function parseJson(text: string, file: string): { ok: true; value: unknown } | { ok: false; issue: Issue } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(msg);
    let where = "";
    if (pos) {
      const offset = Number(pos[1]);
      const before = text.slice(0, offset);
      const line = before.split("\n").length;
      const col = offset - before.lastIndexOf("\n");
      where = ` (line ${line}, column ${col})`;
    }
    return { ok: false, issue: issue("error", file, "", `Invalid JSON${where}: ${msg}`, "Check for missing commas, quotes or brackets.") };
  }
}

/** Zod issues -> our issues. */
export function fromZod(
  file: string,
  zodIssues: readonly { path: readonly PathSegment[]; message: string }[],
  prefix: readonly PathSegment[] = [],
): Issue[] {
  return zodIssues.map((zi) => issue("error", file, formatPath([...prefix, ...zi.path]), zi.message));
}
