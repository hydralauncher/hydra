import fs from "node:fs";
import path from "node:path";

export const TREES = [
  {
    name: "desktop",
    dir: "src/locales",
    registry: "src/locales/index.ts",
    sourceRoots: ["src/renderer/src", "src/main", "src/shared"],
  },
  {
    name: "big-picture",
    dir: "src/big-picture/src/locales",
    registry: "src/big-picture/src/locales/index.ts",
    sourceRoots: ["src/big-picture/src"],
  },
];

export const REFERENCE_LOCALE = "en";
export const TRANSLATION_FILE = "translation.json";
export const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
export const VARIANT_SUFFIX = /_(zero|one|two|few|many|other|male|female)$/;
export const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
export const NESTING = /\$t\(\s*['"]([^'"]+)['"]/g;
export const SOURCE_EXTENSIONS = [".ts", ".tsx"];

export const byText = (first, second) => first.localeCompare(second);
export const byFirstEntry = ([first], [second]) => first.localeCompare(second);

export function fileTree(root) {
  const resolve = (target) => path.join(root, target);

  return {
    root,
    exists(target) {
      return fs.existsSync(resolve(target));
    },
    listLocales(dir) {
      const absolute = resolve(dir);
      if (!fs.existsSync(absolute)) return null;

      return fs
        .readdirSync(absolute, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) =>
          fs.existsSync(path.join(absolute, name, TRANSLATION_FILE))
        )
        .sort(byText);
    },
    listSources(dir) {
      const absolute = resolve(dir);
      if (!fs.existsSync(absolute)) return [];

      const found = [];
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const next = path.join(current, entry.name);

          if (entry.isDirectory()) {
            walk(next);
            continue;
          }

          if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
            found.push(path.relative(root, next).split(path.sep).join("/"));
          }
        }
      };

      walk(absolute);

      return found.sort(byText);
    },
    read(file) {
      const absolute = resolve(file);
      if (!fs.existsSync(absolute)) return null;

      return fs.readFileSync(absolute, "utf8");
    },
  };
}

export function localeFile(tree, locale) {
  return path.posix.join(tree.dir, locale, TRANSLATION_FILE);
}

export function parseLocale(text) {
  try {
    return { json: JSON.parse(text), error: null };
  } catch (error) {
    return { json: null, error: error.message };
  }
}

export function flatten(value, prefix, out) {
  for (const [key, entry] of Object.entries(value)) {
    const flatKey = prefix ? `${prefix}.${key}` : key;

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      flatten(entry, flatKey, out);
    } else {
      out.set(flatKey, entry);
    }
  }

  return out;
}

export function flattenText(text) {
  if (text === null) return null;

  const parsed = parseLocale(text);
  if (parsed.error !== null) return null;

  return flatten(parsed.json, "", new Map());
}

export function placeholdersOf(value) {
  if (typeof value !== "string") return "";

  return [...value.matchAll(PLACEHOLDER)]
    .map((match) => match[1].replaceAll(/\s+/g, ""))
    .sort(byText)
    .join("|");
}

export function nestingRefsOf(value) {
  if (typeof value !== "string") return [];

  return [...value.matchAll(NESTING)].map((match) => match[1]);
}

export function typeNameOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";

  return typeof value;
}

export function variantBasesOf(keys) {
  const bases = new Set();

  for (const key of keys) {
    if (VARIANT_SUFFIX.test(key)) bases.add(key.replace(VARIANT_SUFFIX, ""));
  }

  return bases;
}

function decodeKey(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function readStringToken(text, start, line) {
  let cursor = start + 1;
  let raw = "";
  let currentLine = line;

  while (cursor < text.length && text[cursor] !== '"') {
    if (text[cursor] === "\\") {
      raw += text.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    if (text[cursor] === "\n") currentLine += 1;
    raw += text[cursor];
    cursor += 1;
  }

  return { raw, nextIndex: cursor + 1, line: currentLine };
}

export function scanKeys(text) {
  const lines = new Map();
  const duplicates = [];
  const frames = [];
  const state = { expectKey: false, lastKey: null };
  let line = 1;
  let index = 0;

  const scopePath = () =>
    frames
      .map((frame) => frame.name)
      .filter((name) => name !== null)
      .join(".");

  const recordKey = (raw, startLine) => {
    const name = decodeKey(raw);
    const frame = frames.at(-1);
    const scope = scopePath();
    const flatKey = scope ? `${scope}.${name}` : name;

    if (frame?.seen.has(name)) {
      duplicates.push({ key: flatKey, line: startLine });
    }

    frame?.seen.add(name);
    lines.set(flatKey, startLine);
    state.lastKey = name;
    state.expectKey = false;
  };

  const openFrame = (char) => {
    frames.push({
      seen: new Set(),
      name: state.lastKey,
      isObject: char === "{",
    });
    state.lastKey = null;
    state.expectKey = char === "{";
  };

  const closeFrame = () => {
    frames.pop();
    state.expectKey = false;
    state.lastKey = null;
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '"') {
      const token = readStringToken(text, index, line);
      if (state.expectKey) recordKey(token.raw, line);
      line = token.line;
      index = token.nextIndex;
      continue;
    }

    if (char === "\n") line += 1;
    else if (char === "{" || char === "[") openFrame(char);
    else if (char === "}" || char === "]") closeFrame();
    else if (char === ",") state.expectKey = Boolean(frames.at(-1)?.isObject);
    else if (char === ":") state.expectKey = false;

    index += 1;
  }

  return { lines, duplicates };
}
