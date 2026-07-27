import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TREES = [
  {
    name: "desktop",
    dir: "src/locales",
    registry: "src/locales/index.ts",
  },
  {
    name: "big-picture",
    dir: "src/big-picture/src/locales",
    registry: "src/big-picture/src/locales/index.ts",
  },
];

const REFERENCE_LOCALE = "en";
const TRANSLATION_FILE = "translation.json";
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const ANNOTATION_LIMIT = 40;
const SUMMARY_LIMIT = 60;

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const workingTree = {
  listLocales(dir) {
    if (!fs.existsSync(dir)) return null;

    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(dir, name, TRANSLATION_FILE)))
      .sort();
  },
  read(file) {
    if (!fs.existsSync(file)) return null;

    return fs.readFileSync(file, "utf8");
  },
};

function gitTree(sha) {
  return {
    listLocales(dir) {
      const output = git(["ls-tree", "-d", "--name-only", `${sha}:${dir}`]);
      if (output === null) return null;

      return output
        .split("\n")
        .filter(Boolean)
        .filter(
          (name) =>
            git([
              "cat-file",
              "-e",
              `${sha}:${dir}/${name}/${TRANSLATION_FILE}`,
            ]) !== null
        )
        .sort();
    },
    read(file) {
      return git(["show", `${sha}:${file}`]);
    },
  };
}

function flatten(value, prefix, out) {
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

function placeholdersOf(value) {
  if (typeof value !== "string") return "";

  return [...value.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .sort()
    .join("|");
}

function scanKeys(text) {
  const lines = new Map();
  const duplicates = [];
  const frames = [];
  let expectKey = false;
  let lastKey = null;
  let line = 1;
  let index = 0;

  const scopePath = () =>
    frames
      .map((frame) => frame.name)
      .filter((name) => name !== null)
      .join(".");

  while (index < text.length) {
    const char = text[index];

    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }

    if (char === '"') {
      const startLine = line;
      let cursor = index + 1;
      let raw = "";

      while (cursor < text.length && text[cursor] !== '"') {
        if (text[cursor] === "\\") {
          raw += text.slice(cursor, cursor + 2);
          cursor += 2;
          continue;
        }

        if (text[cursor] === "\n") line += 1;
        raw += text[cursor];
        cursor += 1;
      }

      if (expectKey) {
        let name = raw;

        try {
          name = JSON.parse(`"${raw}"`);
        } catch {
          name = raw;
        }

        const frame = frames.at(-1);
        const scope = scopePath();
        const flatKey = scope ? `${scope}.${name}` : name;

        if (frame?.seen.has(name)) {
          duplicates.push({ key: flatKey, line: startLine });
        }

        frame?.seen.add(name);
        lines.set(flatKey, startLine);
        lastKey = name;
        expectKey = false;
      }

      index = cursor + 1;
      continue;
    }

    if (char === "{" || char === "[") {
      frames.push({ seen: new Set(), name: lastKey, isObject: char === "{" });
      lastKey = null;
      expectKey = char === "{";
      index += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      frames.pop();
      expectKey = false;
      lastKey = null;
      index += 1;
      continue;
    }

    if (char === ",") {
      expectKey = Boolean(frames.at(-1)?.isObject);
      index += 1;
      continue;
    }

    if (char === ":") {
      expectKey = false;
      index += 1;
      continue;
    }

    index += 1;
  }

  return { lines, duplicates };
}

function parseLocale(text) {
  try {
    return { json: JSON.parse(text), error: null };
  } catch (error) {
    return { json: null, error: error.message };
  }
}

function collectFindings(source) {
  const findings = [];
  const locales = new Set();

  const push = (finding) =>
    findings.push({
      ...finding,
      id: `${finding.tree}|${finding.locale}|${finding.kind}|${finding.key}`,
    });

  for (const tree of TREES) {
    const treeLocales = source.listLocales(tree.dir);
    if (treeLocales === null) continue;

    const registry = source.read(tree.registry) ?? "";
    const referenceFile = path.posix.join(
      tree.dir,
      REFERENCE_LOCALE,
      TRANSLATION_FILE
    );
    const referenceText = source.read(referenceFile);
    if (referenceText === null) continue;

    const parsedReference = parseLocale(referenceText);
    if (parsedReference.error !== null) {
      push({
        tree: tree.name,
        locale: REFERENCE_LOCALE,
        kind: "parse-error",
        key: "",
        file: referenceFile,
        line: 1,
        message: `cannot parse reference locale: ${parsedReference.error}`,
      });
      continue;
    }

    const reference = flatten(parsedReference.json, "", new Map());
    const referencePluralBases = new Set();

    for (const key of reference.keys()) {
      if (PLURAL_SUFFIX.test(key)) {
        referencePluralBases.add(key.replace(PLURAL_SUFFIX, ""));
      }
    }

    for (const locale of treeLocales) {
      const file = path.posix.join(tree.dir, locale, TRANSLATION_FILE);
      const text = source.read(file);
      if (text === null) continue;

      locales.add(`${tree.name}|${locale}`);

      if (!registry.includes(`./${locale}/${TRANSLATION_FILE}`)) {
        push({
          tree: tree.name,
          locale,
          kind: "unregistered",
          key: "",
          file: tree.registry,
          line: 1,
          message: `locale "${locale}" ships a ${TRANSLATION_FILE} but is never imported, so it is unreachable`,
        });
      }

      const parsed = parseLocale(text);
      if (parsed.error !== null) {
        push({
          tree: tree.name,
          locale,
          kind: "parse-error",
          key: "",
          file,
          line: 1,
          message: `cannot parse: ${parsed.error}`,
        });
        continue;
      }

      const { lines, duplicates } = scanKeys(text);

      for (const duplicate of duplicates) {
        push({
          tree: tree.name,
          locale,
          kind: "duplicate",
          key: duplicate.key,
          file,
          line: duplicate.line,
          message: `duplicate key "${duplicate.key}", the last occurrence silently wins and the other translation is dropped`,
        });
      }

      if (locale === REFERENCE_LOCALE) continue;

      const flat = flatten(parsed.json, "", new Map());

      for (const [key, value] of reference) {
        if (!flat.has(key)) {
          push({
            tree: tree.name,
            locale,
            kind: "missing",
            key,
            file,
            line: 1,
            message: `missing key "${key}", it will fall back to ${REFERENCE_LOCALE}`,
          });
          continue;
        }

        const localeValue = flat.get(key);

        if (typeof value === "string" && typeof localeValue !== "string") {
          const actualType = Array.isArray(localeValue)
            ? "array"
            : localeValue === null
              ? "null"
              : typeof localeValue;

          push({
            tree: tree.name,
            locale,
            kind: "type",
            key,
            file,
            line: lines.get(key) ?? 1,
            message: `"${key}" should be a string to match ${REFERENCE_LOCALE}, found ${actualType}`,
          });
          continue;
        }

        const expected = placeholdersOf(value);
        const actual = placeholdersOf(localeValue);

        if (expected !== actual) {
          push({
            tree: tree.name,
            locale,
            kind: "placeholder",
            key,
            file,
            line: lines.get(key) ?? 1,
            message: `"${key}" placeholders differ, ${REFERENCE_LOCALE} has [${expected}] and ${locale} has [${actual}]`,
          });
        }
      }

      for (const key of flat.keys()) {
        if (reference.has(key)) continue;

        if (
          PLURAL_SUFFIX.test(key) &&
          referencePluralBases.has(key.replace(PLURAL_SUFFIX, ""))
        ) {
          continue;
        }

        push({
          tree: tree.name,
          locale,
          kind: "extra",
          key,
          file,
          line: lines.get(key) ?? 1,
          message: `"${key}" does not exist in the ${REFERENCE_LOCALE} locale, it is dead weight or a leftover rename`,
        });
      }
    }
  }

  return { findings, locales };
}

function referenceDelta(baseSource, headSource) {
  const added = new Set();
  const removed = new Set();
  const placeholderChanged = new Set();

  for (const tree of TREES) {
    const file = path.posix.join(tree.dir, REFERENCE_LOCALE, TRANSLATION_FILE);
    const baseText = baseSource.read(file);
    const headText = headSource.read(file);
    if (baseText === null || headText === null) continue;

    const base = parseLocale(baseText);
    const head = parseLocale(headText);
    if (base.error !== null || head.error !== null) continue;

    const baseFlat = flatten(base.json, "", new Map());
    const headFlat = flatten(head.json, "", new Map());

    for (const key of headFlat.keys()) {
      if (!baseFlat.has(key)) added.add(`${tree.name}|${key}`);
    }

    for (const key of baseFlat.keys()) {
      if (!headFlat.has(key)) removed.add(`${tree.name}|${key}`);
    }

    for (const [key, value] of headFlat) {
      if (!baseFlat.has(key)) continue;

      if (placeholdersOf(value) !== placeholdersOf(baseFlat.get(key))) {
        placeholderChanged.add(`${tree.name}|${key}`);
      }
    }
  }

  return { added, removed, placeholderChanged };
}

function isIntroducedByPullRequest(finding, delta) {
  const scoped = `${finding.tree}|${finding.key}`;

  if (finding.kind === "missing") return delta.added.has(scoped);
  if (finding.kind === "extra") return delta.removed.has(scoped);
  if (finding.kind === "placeholder") {
    return delta.added.has(scoped) || delta.placeholderChanged.has(scoped);
  }

  return false;
}

function groupCounts(findings) {
  const counts = new Map();

  for (const finding of findings) {
    const scope = `${finding.tree}/${finding.locale}`;
    const byKind = counts.get(scope) ?? new Map();
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
    counts.set(scope, byKind);
  }

  return counts;
}

function annotate(findings) {
  for (const finding of findings.slice(0, ANNOTATION_LIMIT)) {
    const title = `locale ${finding.kind}: ${finding.tree}/${finding.locale}`;
    const message = finding.message.replaceAll("\n", "%0A");

    process.stdout.write(
      `::error file=${finding.file},line=${finding.line},title=${title}::${message}\n`
    );
  }

  if (findings.length > ANNOTATION_LIMIT) {
    process.stdout.write(
      `::notice::${findings.length - ANNOTATION_LIMIT} further locale problems were found but not annotated, see the job summary\n`
    );
  }
}

function writeSummary(body) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;

  fs.appendFileSync(target, `${body}\n`);
}

function renderSummary(title, findings, inherited) {
  const rows = [];

  for (const [scope, byKind] of [...groupCounts(findings)].sort()) {
    const detail = [...byKind]
      .sort()
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ");
    rows.push(`| \`${scope}\` | ${detail} |`);
  }

  const lines = [`## ${title}`, ""];

  if (rows.length > 0) {
    lines.push("| locale | problems |", "| --- | --- |", ...rows, "");
  }

  if (findings.length > 0) {
    lines.push("<details><summary>Details</summary>", "");
    lines.push("```");

    for (const finding of findings.slice(0, SUMMARY_LIMIT)) {
      lines.push(
        `${finding.file}:${finding.line}  [${finding.kind}] ${finding.message}`
      );
    }

    if (findings.length > SUMMARY_LIMIT) {
      lines.push(`... and ${findings.length - SUMMARY_LIMIT} more`);
    }

    lines.push("```", "", "</details>", "");
  }

  if (inherited !== null) {
    lines.push(
      `Pre-existing problems inherited from the base branch: **${inherited}**. Those are not blocking this pull request.`,
      ""
    );
  }

  return lines.join("\n");
}

function reportOnly(findings) {
  process.stdout.write(
    `No base revision to compare against, reporting only.\n\n`
  );

  for (const [scope, byKind] of [...groupCounts(findings)].sort()) {
    const detail = [...byKind]
      .sort()
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ");
    process.stdout.write(`  ${scope}  ${detail}\n`);
  }

  process.stdout.write(`\n${findings.length} locale problems in total.\n`);
  writeSummary(renderSummary("Locale report", findings, null));

  return 0;
}

function main() {
  const argumentIndex = process.argv.indexOf("--base");
  const requestedBase =
    argumentIndex === -1
      ? (process.env.LOCALE_CHECK_BASE_SHA ?? "")
      : (process.argv[argumentIndex + 1] ?? "");
  const head = collectFindings(workingTree);

  if (head.findings.some((finding) => finding.kind === "parse-error")) {
    annotate(head.findings.filter((finding) => finding.kind === "parse-error"));
    writeSummary(renderSummary("Locale check failed", head.findings, null));
    process.stdout.write("A locale file could not be parsed.\n");

    return 1;
  }

  const baseSha = requestedBase.replace(/^0+$/, "").trim();

  if (
    !baseSha ||
    git(["rev-parse", "--verify", `${baseSha}^{commit}`]) === null
  ) {
    if (baseSha) {
      process.stdout.write(
        `::warning::base revision ${baseSha} is not reachable, the repository may be shallow cloned\n`
      );
    }

    return reportOnly(head.findings);
  }

  const baseSource = gitTree(baseSha);
  const base = collectFindings(baseSource);
  const baseIds = new Set(base.findings.map((finding) => finding.id));
  const delta = referenceDelta(baseSource, workingTree);

  const introduced = [];
  let inherited = 0;

  for (const finding of head.findings) {
    if (baseIds.has(finding.id)) {
      inherited += 1;
      continue;
    }

    const isNewLocale = !base.locales.has(`${finding.tree}|${finding.locale}`);

    if (!isNewLocale && isIntroducedByPullRequest(finding, delta)) continue;

    introduced.push(finding);
  }

  if (introduced.length === 0) {
    process.stdout.write(
      `No new locale problems. ${inherited} pre-existing problems inherited from ${baseSha.slice(0, 7)}.\n`
    );
    writeSummary(
      [
        "## Locale check",
        "",
        `No new locale problems introduced. **${inherited}** pre-existing problems inherited from the base branch.`,
        "",
      ].join("\n")
    );

    return 0;
  }

  annotate(introduced);
  writeSummary(renderSummary("Locale check failed", introduced, inherited));

  process.stdout.write(
    `\n${introduced.length} locale problems introduced by this change:\n\n`
  );

  for (const finding of introduced.slice(0, SUMMARY_LIMIT)) {
    process.stdout.write(
      `  ${finding.file}:${finding.line}  [${finding.kind}] ${finding.message}\n`
    );
  }

  if (introduced.length > SUMMARY_LIMIT) {
    process.stdout.write(
      `  ... and ${introduced.length - SUMMARY_LIMIT} more\n`
    );
  }

  process.stdout.write(
    `\n${inherited} pre-existing problems were inherited and are not blocking.\n`
  );

  return 1;
}

process.exitCode = main();
