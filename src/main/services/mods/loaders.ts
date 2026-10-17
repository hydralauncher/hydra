import type { ModLoaderId } from "../../../types/mods.types";

export interface FileMove {
  from: string; // path inside the extracted package (posix, relative)
  to: string; // path relative to game dir (posix)
}

export interface LoaderDefinition {
  id: ModLoaderId;
  /** Does this package name (without owner) install the loader itself? */
  isLoaderPackage: (name: string) => boolean;
  planLoader: (files: string[]) => FileMove[];
  planMod: (files: string[], fullName: string) => FileMove[];
  /** Files under these prefixes are never renamed when a mod is disabled. */
  keepOnDisable: string[];
}

const PACKAGE_META = new Set([
  "manifest.json",
  "icon.png",
  "readme.md",
  "changelog.md",
  "license",
  "license.txt",
  "license.md",
]);

const isMeta = (rel: string) =>
  !rel.includes("/") && PACKAGE_META.has(rel.toLowerCase());

const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");

const topOf = (rel: string) => rel.split("/")[0];

/** Strips a single wrapping folder shared by every file (e.g. BepInExPack/). */
const stripWrapper = (files: string[]): string[] => {
  const tops = new Set(files.map(topOf));
  const allNested = files.every((f) => f.includes("/"));
  return tops.size === 1 && allNested
    ? files.map((f) => f.slice(f.indexOf("/") + 1))
    : files;
};

const bepinex: LoaderDefinition = {
  id: "bepinex",
  keepOnDisable: ["BepInEx/config/"],
  isLoaderPackage: (name) =>
    /^bepinexpack/i.test(name) || /^bepinex_pack/i.test(name),

  planLoader(rawFiles) {
    const files = rawFiles.map(normalize).filter((f) => !isMeta(f));
    const stripped = stripWrapper(files);
    return files.map((from, i) => ({ from, to: stripped[i] }));
  },

  planMod(rawFiles, fullName) {
    const files = rawFiles.map(normalize).filter((f) => !isMeta(f));
    const moves: FileMove[] = [];

    for (const from of files) {
      const parts = from.split("/");
      const top = parts[0].toLowerCase();
      const rest = parts.slice(1).join("/");

      if (top === "bepinex" && parts.length > 1) {
        moves.push({ from, to: from });
      } else if (parts.length === 1) {
        moves.push({ from, to: `BepInEx/plugins/${fullName}/${from}` });
      } else if (
        top === "plugins" ||
        top === "patchers" ||
        top === "monomod" ||
        top === "core"
      ) {
        moves.push({ from, to: `BepInEx/${top}/${fullName}/${rest}` });
      } else if (top === "config") {
        moves.push({ from, to: `BepInEx/config/${rest}` });
      } else {
        moves.push({ from, to: `BepInEx/plugins/${fullName}/${from}` });
      }
    }
    return moves;
  },
};

const MELON_FOLDERS: Record<string, string> = {
  mods: "Mods",
  plugins: "Plugins",
  userlibs: "UserLibs",
  userdata: "UserData",
  melonloader: "MelonLoader",
};

const melonloader: LoaderDefinition = {
  id: "melonloader",
  keepOnDisable: ["UserData/"],
  isLoaderPackage: (name) => /^melonloader$/i.test(name),

  planLoader(rawFiles) {
    return rawFiles
      .map(normalize)
      .filter((f) => !isMeta(f))
      .map((from) => ({ from, to: from }));
  },

  planMod(rawFiles) {
    const moves: FileMove[] = [];
    for (const from of rawFiles.map(normalize).filter((f) => !isMeta(f))) {
      const parts = from.split("/");
      const mapped = MELON_FOLDERS[parts[0].toLowerCase()];
      if (mapped && parts.length > 1) {
        moves.push({ from, to: `${mapped}/${parts.slice(1).join("/")}` });
      } else {
        moves.push({ from, to: `Mods/${from}` });
      }
    }
    return moves;
  },
};

export const LOADERS: Record<ModLoaderId, LoaderDefinition> = {
  bepinex,
  melonloader,
};

/** Maps r2modman/ecosystem `packageLoader` strings to supported loaders. */
export const toSupportedLoader = (
  raw: string | undefined | null
): ModLoaderId | null => {
  const key = (raw ?? "bepinex").toLowerCase().replace(/[^a-z]/g, "");
  if (key === "bepinex") return "bepinex";
  if (key === "melonloader" || key === "recursivemelonloader")
    return "melonloader";
  return null;
};

/** Guards against zip-slip: destination must stay inside the game dir. */
export const isSafeRelativePath = (rel: string): boolean => {
  const n = normalize(rel);
  return (
    !!n &&
    !n.split("/").some((s) => s === ".." || s === "") &&
    !/^[a-zA-Z]:/.test(n)
  );
};
