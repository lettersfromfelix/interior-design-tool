/** Repository-relative POSIX paths of catalogue files. */

/** Folder of a file: "catalogue/stool/item.json" -> "catalogue/stool". */
export const dirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/**
 * The id a catalogue file should have: its file name without ".json", or the folder name for "item.json"
 * ("catalogue/sofa.json" -> "sofa", "catalogue/example-stool-glb/item.json" -> "example-stool-glb").
 */
export function expectedId(path: string): string {
  const parts = path.split("/");
  const base = parts[parts.length - 1].replace(/\.json$/i, "");
  return base.toLowerCase() === "item" && parts.length > 2 ? parts[parts.length - 2] : base;
}

/**
 * Resolve a path relative to a folder ("catalogue/stool" + "model.glb" -> "catalogue/stool/model.glb").
 * Returns undefined if the result would leave `root` (e.g. "../../src/x.glb") or the path is absolute.
 */
export function resolveRelative(folder: string, rel: string, root = "catalogue"): string | undefined {
  if (/^([a-z]+:|\/)/i.test(rel)) return undefined;
  const out = folder ? folder.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(seg);
  }
  const path = out.join("/");
  return path === root || path.startsWith(`${root}/`) ? path : undefined;
}
