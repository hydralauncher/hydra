import fs from "node:fs/promises";
import path from "node:path";
import { parseRegFile } from "../../helpers/reg-parser.js";
import { EpicSaveFailure } from "./cloud-save-protocol.js";

/** Keep existing Linux casing/symlinks; only Windows references get case lookup. */
export async function resolveLinuxEpicSavePath(value: string): Promise<string> {
  const absolute = path.resolve(value);
  const root = path.parse(absolute).root;
  let current = root;
  const segments = path
    .relative(root, absolute)
    .split(path.sep)
    .filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return path.join(current, ...segments.slice(index));
      throw error;
    }
    const matches = entries.includes(segment)
      ? [segment]
      : entries.filter(
          (entry) => entry.toLowerCase() === segment.toLowerCase()
        );
    if (matches.length > 1) throw new EpicSaveFailure("invalid-path");
    if (!matches.length) return path.join(current, ...segments.slice(index));
    current = await fs.realpath(path.join(current, matches[0]));
  }
  return current;
}

export async function linuxEpicSaveVariables(
  prefix: string,
  profile: { path: string; windowsPath?: string }
): Promise<Record<string, string>> {
  const variables: Record<string, string> = {
    "{userprofile}": profile.path,
    "{userdir}": path.join(profile.path, "Documents"),
    "{usersavedgames}": path.join(profile.path, "Saved Games"),
    "{appdata}": path.join(profile.path, "AppData", "Local"),
    "{roaming}": path.join(profile.path, "AppData", "Roaming"),
    "{locallow}": path.join(profile.path, "AppData", "LocalLow"),
  };
  const knownNames: Record<string, string[]> = {
    "{userdir}": ["personal", "{fdd39ad0-238f-46af-adb4-6c85480369c7}"],
    "{usersavedgames}": ["{4c5c32ff-bb9d-43b0-bf2b-84d269d740f9}"],
    "{appdata}": ["local appdata"],
    "{roaming}": ["appdata"],
    "{locallow}": ["{a520a1a4-1780-4ff6-bd18-167343c5af16}"],
  };
  const folders = new Map<string, string>();
  try {
    const registry = parseRegFile(
      await fs.readFile(path.join(prefix, "user.reg"), "utf8")
    );
    // Expanded Shell Folders wins over its expandable User Shell Folders source.
    for (const kind of ["user shell folders", "shell folders"]) {
      for (const entry of registry) {
        const key = entry.path.replace(/\\+/g, "\\").toLowerCase();
        if (!key.endsWith(`\\explorer\\${kind}`)) continue;
        for (const [name, value] of Object.entries(entry.values))
          if (typeof value === "string") folders.set(name.toLowerCase(), value);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const [variable, names] of Object.entries(knownNames)) {
    const stored = names.map((name) => folders.get(name)).find(Boolean);
    if (!stored) continue;
    const raw = /^str\(2\):"(.*)"$/.exec(stored)?.[1] ?? stored;
    const expanded = raw
      .replace(/%USERPROFILE%/gi, profile.windowsPath ?? "")
      .replaceAll("/", "\\")
      .replace(/\\+/g, "\\");
    if (expanded.includes("%") || !/^[A-Za-z]:\\/.test(expanded)) continue;
    const drive = path.join(
      prefix,
      "dosdevices",
      expanded.slice(0, 2).toLowerCase()
    );
    const root = await fs.realpath(drive).catch(() => null);
    if (!root) continue;
    const relative = expanded.slice(3).split("\\");
    if (relative.some((segment) => segment === ".."))
      throw new EpicSaveFailure("invalid-path");
    variables[variable] = path.join(root, ...relative);
  }
  for (const [name, value] of Object.entries(variables))
    variables[name] = await resolveLinuxEpicSavePath(value);
  return variables;
}
