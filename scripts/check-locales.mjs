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
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const ANNOTATION_LIMIT = 40;
const SUMMARY_LIMIT = 60;

const byText = (first, second) => first.localeCompare(second);
const byFirstEntry = ([first], [second]) => first.localeCompare(second);

function fileTree(root) {
  const resolve = (target) => path.join(root, target);

  return {
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
    read(file) {
      const absolute = resolve(file);
      if (!fs.existsSync(absolute)) return null;

      return fs.readFileSync(absolute, "utf8");
    },
  };
}

const workingTree = fileTree(".");

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

function flattenText(text) {
  const parsed = parseLocale(text);
  if (parsed.error !== null) return null;

  return flatten(parsed.json, "", new Map());
}

function placeholdersOf(value) {
  if (typeof value !== "string") return "";

  return [...value.matchAll(PLACEHOLDER)]
    .map((match) => match[1].trim())
    .sort(byText)
    .join("|");
}

function typeNameOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";

  return typeof value;
}

function parseLocale(text) {
  try {
    return { json: JSON.parse(text), error: null };
  } catch (error) {
    return { json: null, error: error.message };
  }
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

function scanKeys(text) {
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

function pluralBasesOf(keys) {
  const bases = new Set();

  for (const key of keys) {
    if (PLURAL_SUFFIX.test(key)) bases.add(key.replace(PLURAL_SUFFIX, ""));
  }

  return bases;
}

function checkDuplicates(context, duplicates) {
  for (const duplicate of duplicates) {
    context.push({
      kind: "duplicate",
      key: duplicate.key,
      file: context.file,
      line: duplicate.line,
      message: `duplicate key "${duplicate.key}", the last occurrence silently wins and the other translation is dropped`,
    });
  }
}

function checkAgainstReference(context) {
  const { reference, flat, lines } = context;

  for (const [key, value] of reference) {
    if (!flat.has(key)) {
      context.push({
        kind: "missing",
        key,
        file: context.file,
        line: 1,
        message: `missing key "${key}", it will fall back to ${REFERENCE_LOCALE}`,
      });
      continue;
    }

    const localeValue = flat.get(key);

    if (typeof value === "string" && typeof localeValue !== "string") {
      context.push({
        kind: "type",
        key,
        file: context.file,
        line: lines.get(key) ?? 1,
        message: `"${key}" should be a string to match ${REFERENCE_LOCALE}, found ${typeNameOf(localeValue)}`,
      });
      continue;
    }

    const expected = placeholdersOf(value);
    const actual = placeholdersOf(localeValue);

    if (expected !== actual) {
      context.push({
        kind: "placeholder",
        key,
        file: context.file,
        line: lines.get(key) ?? 1,
        message: `"${key}" placeholders differ, ${REFERENCE_LOCALE} has [${expected}] and ${context.locale} has [${actual}]`,
      });
    }
  }
}

function checkExtraKeys(context) {
  const { reference, referencePluralBases, flat, lines } = context;

  for (const key of flat.keys()) {
    if (reference.has(key)) continue;

    const isKnownPlural =
      PLURAL_SUFFIX.test(key) &&
      referencePluralBases.has(key.replace(PLURAL_SUFFIX, ""));

    if (isKnownPlural) continue;

    context.push({
      kind: "extra",
      key,
      file: context.file,
      line: lines.get(key) ?? 1,
      message: `"${key}" does not exist in the ${REFERENCE_LOCALE} locale, it is dead weight or a leftover rename`,
    });
  }
}

function checkLocale(source, tree, locale, shared, collect) {
  const file = path.posix.join(tree.dir, locale, TRANSLATION_FILE);
  const text = source.read(file);
  if (text === null) return;

  collect.locales.add(`${tree.name}|${locale}`);

  const push = (finding) => collect.push({ ...finding, tree, locale });

  if (!shared.registry.includes(`./${locale}/${TRANSLATION_FILE}`)) {
    push({
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
      kind: "parse-error",
      key: "",
      file,
      line: 1,
      message: `cannot parse: ${parsed.error}`,
    });
    return;
  }

  const { lines, duplicates } = scanKeys(text);
  const context = { ...shared, locale, file, lines, push };

  checkDuplicates(context, duplicates);

  if (locale === REFERENCE_LOCALE) return;

  context.flat = flatten(parsed.json, "", new Map());
  checkAgainstReference(context);
  checkExtraKeys(context);
}

function checkTree(source, tree, collect) {
  const treeLocales = source.listLocales(tree.dir);
  if (treeLocales === null) return;

  const referenceFile = path.posix.join(
    tree.dir,
    REFERENCE_LOCALE,
    TRANSLATION_FILE
  );
  const referenceText = source.read(referenceFile);
  if (referenceText === null) return;

  const parsedReference = parseLocale(referenceText);
  if (parsedReference.error !== null) {
    collect.push({
      tree,
      locale: REFERENCE_LOCALE,
      kind: "parse-error",
      key: "",
      file: referenceFile,
      line: 1,
      message: `cannot parse reference locale: ${parsedReference.error}`,
    });
    return;
  }

  const reference = flatten(parsedReference.json, "", new Map());
  const shared = {
    registry: source.read(tree.registry) ?? "",
    reference,
    referencePluralBases: pluralBasesOf(reference.keys()),
  };

  for (const locale of treeLocales) {
    checkLocale(source, tree, locale, shared, collect);
  }
}

function collectFindings(source) {
  const findings = [];
  const locales = new Set();

  const collect = {
    locales,
    push: (finding) =>
      findings.push({
        ...finding,
        tree: finding.tree.name,
        id: `${finding.tree.name}|${finding.locale}|${finding.kind}|${finding.key}`,
      }),
  };

  for (const tree of TREES) {
    checkTree(source, tree, collect);
  }

  return { findings, locales };
}

function diffReferenceTree(treeName, baseFlat, headFlat, delta) {
  for (const key of headFlat.keys()) {
    if (!baseFlat.has(key)) delta.added.add(`${treeName}|${key}`);
  }

  for (const key of baseFlat.keys()) {
    if (!headFlat.has(key)) delta.removed.add(`${treeName}|${key}`);
  }

  for (const [key, value] of headFlat) {
    if (!baseFlat.has(key)) continue;

    if (placeholdersOf(value) !== placeholdersOf(baseFlat.get(key))) {
      delta.placeholderChanged.add(`${treeName}|${key}`);
    }
  }
}

function referenceDelta(baseSource, headSource) {
  const delta = {
    added: new Set(),
    removed: new Set(),
    placeholderChanged: new Set(),
  };

  for (const tree of TREES) {
    const file = path.posix.join(tree.dir, REFERENCE_LOCALE, TRANSLATION_FILE);
    const baseText = baseSource.read(file);
    const headText = headSource.read(file);
    if (baseText === null || headText === null) continue;

    const baseFlat = flattenText(baseText);
    const headFlat = flattenText(headText);
    if (baseFlat === null || headFlat === null) continue;

    diffReferenceTree(tree.name, baseFlat, headFlat, delta);
  }

  return delta;
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

function countedScopes(findings) {
  return [...groupCounts(findings)]
    .sort(byFirstEntry)
    .map(([scope, byKind]) => ({
      scope,
      detail: [...byKind]
        .sort(byFirstEntry)
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(", "),
    }));
}

function describe(finding) {
  return `${finding.file}:${finding.line}  [${finding.kind}] ${finding.message}`;
}

function annotate(findings, level = "error") {
  for (const finding of findings.slice(0, ANNOTATION_LIMIT)) {
    const title = `locale ${finding.kind}: ${finding.tree}/${finding.locale}`;
    const message = finding.message.replaceAll("\n", "%0A");

    process.stdout.write(
      `::${level} file=${finding.file},line=${finding.line},title=${title}::${message}\n`
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

function summaryTable(findings) {
  const rows = countedScopes(findings).map(
    ({ scope, detail }) => `| \`${scope}\` | ${detail} |`
  );

  if (rows.length === 0) return [];

  return ["| locale | problems |", "| --- | --- |", ...rows, ""];
}

function summaryDetails(findings) {
  if (findings.length === 0) return [];

  const shown = findings.slice(0, SUMMARY_LIMIT).map(describe);

  if (findings.length > SUMMARY_LIMIT) {
    shown.push(`... and ${findings.length - SUMMARY_LIMIT} more`);
  }

  return [
    "<details><summary>Details</summary>",
    "",
    "```",
    ...shown,
    "```",
    "",
    "</details>",
    "",
  ];
}

function renderSummary(title, findings, inherited) {
  const inheritedNote =
    inherited === null
      ? []
      : [
          `Pre-existing problems inherited from the base branch: **${inherited}**. Those are not blocking this pull request.`,
          "",
        ];

  return [
    `## ${title}`,
    "",
    ...summaryTable(findings),
    ...summaryDetails(findings),
    ...inheritedNote,
  ].join("\n");
}

function reportOnly(findings) {
  process.stdout.write(
    `No base locales to compare against, reporting only.\n\n`
  );

  for (const { scope, detail } of countedScopes(findings)) {
    process.stdout.write(`  ${scope}  ${detail}\n`);
  }

  process.stdout.write(`\n${findings.length} locale problems in total.\n`);
  writeSummary(renderSummary("Locale report", findings, null));

  return 0;
}

function readOption(flag, variable) {
  const argumentIndex = process.argv.indexOf(flag);
  const requested =
    argumentIndex === -1
      ? (process.env[variable] ?? "")
      : (process.argv[argumentIndex + 1] ?? "");

  return requested.trim();
}

function writeList(findings) {
  for (const finding of findings.slice(0, SUMMARY_LIMIT)) {
    process.stdout.write(`  ${describe(finding)}\n`);
  }

  if (findings.length > SUMMARY_LIMIT) {
    process.stdout.write(`  ... and ${findings.length - SUMMARY_LIMIT} more\n`);
  }
}

function renderAdvisory(advisory) {
  if (advisory.length === 0) return [];

  return [
    "### Untranslated keys in the locales this change touches",
    "",
    "Not blocking, listed so the gap is visible.",
    "",
    ...summaryTable(advisory),
    ...summaryDetails(advisory),
  ];
}

function reportIntroduced(introduced, advisory, inherited) {
  annotate(introduced);
  annotate(advisory, "warning");
  writeSummary(
    [
      renderSummary("Locale check failed", introduced, inherited),
      ...renderAdvisory(advisory),
    ].join("\n")
  );

  process.stdout.write(
    `\n${introduced.length} locale problems introduced by this change:\n\n`
  );
  writeList(introduced);

  if (advisory.length > 0) {
    process.stdout.write(
      `\n${advisory.length} keys are still untranslated in the locales this change touches, not blocking:\n\n`
    );
    writeList(advisory);
  }

  process.stdout.write(
    `\n${inherited} pre-existing problems were inherited and are not blocking.\n`
  );

  return 1;
}

function reportClean(advisory, inherited, baseLabel) {
  annotate(advisory, "warning");
  process.stdout.write(
    `No new locale problems. ${inherited} pre-existing problems inherited from ${baseLabel}.\n`
  );

  if (advisory.length > 0) {
    process.stdout.write(
      `\n${advisory.length} keys are still untranslated in the locales this change touches, not blocking:\n\n`
    );
    writeList(advisory);
  }

  writeSummary(
    [
      "## Locale check",
      "",
      `No new locale problems introduced. **${inherited}** pre-existing problems inherited from ${baseLabel}.`,
      "",
      ...renderAdvisory(advisory),
    ].join("\n")
  );

  return 0;
}

function touchedLocales(baseSource, headSource) {
  const touched = new Set();

  for (const tree of TREES) {
    for (const locale of headSource.listLocales(tree.dir) ?? []) {
      const file = path.posix.join(tree.dir, locale, TRANSLATION_FILE);

      if (baseSource.read(file) !== headSource.read(file)) {
        touched.add(`${tree.name}|${locale}`);
      }
    }
  }

  return touched;
}

function ratchet(head, baseSource, baseLabel) {
  const base = collectFindings(baseSource);
  const baseIds = new Set(base.findings.map((finding) => finding.id));
  const delta = referenceDelta(baseSource, workingTree);
  const touched = touchedLocales(baseSource, workingTree);

  const introduced = [];
  const advisory = [];
  let inherited = 0;

  for (const finding of head.findings) {
    const scope = `${finding.tree}|${finding.locale}`;
    const isOwned = !base.locales.has(scope) || touched.has(scope);

    if (baseIds.has(finding.id)) {
      inherited += 1;

      if (isOwned && finding.kind === "missing") advisory.push(finding);
      continue;
    }

    if (!isOwned && isIntroducedByPullRequest(finding, delta)) continue;

    introduced.push(finding);
  }

  if (introduced.length === 0) {
    return reportClean(advisory, inherited, baseLabel);
  }

  return reportIntroduced(introduced, advisory, inherited);
}

function main() {
  const head = collectFindings(workingTree);
  const unparseable = head.findings.filter(
    (finding) => finding.kind === "parse-error"
  );

  if (unparseable.length > 0) {
    annotate(unparseable);
    writeSummary(renderSummary("Locale check failed", head.findings, null));
    process.stdout.write("A locale file could not be parsed.\n");

    return 1;
  }

  const baseDir = readOption("--base-dir", "LOCALE_CHECK_BASE_DIR");
  if (!baseDir) return reportOnly(head.findings);

  const baseSource = fileTree(baseDir);
  const hasBaseLocales = TREES.some(
    (tree) => baseSource.listLocales(tree.dir) !== null
  );

  if (!hasBaseLocales) {
    process.stdout.write(
      `::warning::no locale directories found under ${baseDir}, falling back to a report\n`
    );

    return reportOnly(head.findings);
  }

  const baseLabel =
    readOption("--base-label", "LOCALE_CHECK_BASE_LABEL") || "the base branch";

  return ratchet(head, baseSource, baseLabel);
}

process.exitCode = main();
