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

/**
 * Offset of the first syntax error in `text`. A small JSON scanner, used when the JavaScript engine's error message
 * does not include a position (V8 omits it for "Unexpected token" errors).
 */
export function jsonErrorOffset(text: string): number {
  let i = 0;
  const stop = new Error("stop");
  const fail = (): never => {
    throw stop;
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const string = () => {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c < " ") fail();
      i += c === "\\" ? 2 : 1;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      ws();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (c === "{") {
          ws();
          if (text[i] !== '"') fail();
          string();
          ws();
          if (text[i] !== ":") fail();
          i++;
        }
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === close) {
          i++;
          return;
        } else fail();
      }
    }
    if (c === '"') return string();
    const num = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (num) {
      i += num[0].length;
      return;
    }
    const lit = ["true", "false", "null"].find((l) => text.startsWith(l, i));
    if (!lit) fail();
    i += lit!.length;
  };
  try {
    value();
    ws();
    return i < text.length ? i : text.length;
  } catch (e) {
    if (e === stop) return Math.min(i, text.length);
    throw e;
  }
}

/** Parse JSON and report syntax errors with line and column. */
export function parseJson(text: string, file: string): { ok: true; value: unknown } | { ok: false; issue: Issue } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(raw);
    const offset = pos ? Number(pos[1]) : jsonErrorOffset(text);
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const col = offset - before.lastIndexOf("\n");
    // drop V8's own position and source excerpt; we report line and column instead
    const msg = raw
      .replace(/\s*(in JSON )?at position \d+.*$/s, "")
      .replace(/,\s*(\.\.\.)?".*" is not valid JSON$/s, "")
      .trim();
    return {
      ok: false,
      issue: issue("error", file, "", `Invalid JSON (line ${line}, column ${col}): ${msg}`, "Check for missing commas, quotes or brackets."),
    };
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
