import fs from "node:fs";

import {
  REFERENCE_LOCALE,
  TREES,
  byFirstEntry,
  byText,
  fileTree,
  flattenText,
  localeFile,
} from "./locale-check/shared.mjs";
import { checkTreeParity } from "./locale-check/parity.mjs";
import {
  buildNamespaceTable,
  checkUsage,
  reportUnusedKeys,
} from "./locale-check/usage.mjs";
import { checkBigPictureLiterals } from "./locale-check/big-picture.mjs";
import { checkWiring, reportRenames } from "./locale-check/wiring.mjs";

const ANNOTATION_LIMIT = 40;
const SUMMARY_LIMIT = 60;
const SOURCE_KINDS = new Set([
  "usage-key",
  "usage-namespace",
  "usage-no-namespace",
  "bp-literal",
  "wiring",
]);

const ADVISORY_PRIORITY = ["placeholder-drift", "rename", "missing", "unused"];

function aggregatePlaceholderDrift(suppressed) {
  const byKey = new Map();

  for (const finding of suppressed) {
    const identity = `${finding.tree}|${finding.key}`;
    const group = byKey.get(identity) ?? { finding, locales: [] };

    group.locales.push(finding.scope);
    byKey.set(identity, group);
  }

  return [...byKey.values()].map(({ finding, locales }) => {
    const listed = locales.slice(0, 6).join(", ");
    const rest = locales.length > 6 ? ", and more" : "";

    return {
      tree: finding.tree,
      scope: "placeholders",
      kind: "placeholder-drift",
      key: finding.key,
      file: finding.file,
      line: finding.line,
      advisory: true,
      message: `the placeholders in "${finding.key}" changed in ${REFERENCE_LOCALE}, so ${locales.length} locales now interpolate the wrong set (${listed}${rest}) until they are retranslated`,
    };
  });
}

function byAdvisoryPriority(first, second) {
  const rank = (finding) => {
    const index = ADVISORY_PRIORITY.indexOf(finding.kind);

    return index === -1 ? ADVISORY_PRIORITY.length : index;
  };

  return rank(first) - rank(second);
}

const workingTree = fileTree(".");

function createCollector() {
  const findings = [];
  const scopes = new Set();

  return {
    findings,
    scopes,
    push(finding) {
      const tree = finding.tree?.name ?? "source";

      findings.push({
        ...finding,
        tree,
        advisory: finding.advisory === true,
        id: `${tree}|${finding.scope}|${finding.kind}|${finding.key}`,
      });
    },
  };
}

function collectFindings(source, { withSource }) {
  const collect = createCollector();

  for (const tree of TREES) {
    checkTreeParity(source, tree, collect);
  }

  if (!withSource) return { ...collect };

  checkWiring(source, collect);
  checkBigPictureLiterals(source, collect);

  const table = buildNamespaceTable(source);
  const usage = checkUsage(source, table, collect);
  reportUnusedKeys(table, usage, collect);

  return { ...collect, usage };
}

function diffReferenceTree(treeName, baseFlat, headFlat, delta) {
  const treeRemoved = new Set();

  for (const key of headFlat.keys()) {
    if (!baseFlat.has(key)) delta.added.add(`${treeName}|${key}`);
  }

  for (const key of baseFlat.keys()) {
    if (headFlat.has(key)) continue;

    delta.removed.add(`${treeName}|${key}`);
    treeRemoved.add(key);
  }

  for (const [key, value] of headFlat) {
    if (!baseFlat.has(key)) continue;

    if (placeholdersDiffer(value, baseFlat.get(key))) {
      delta.placeholderChanged.add(`${treeName}|${key}`);
    }
  }

  delta.removedByTree.set(treeName, treeRemoved);
}

function referenceDelta(baseSource, headSource) {
  const delta = {
    added: new Set(),
    removed: new Set(),
    placeholderChanged: new Set(),
    removedByTree: new Map(),
  };

  for (const tree of TREES) {
    const file = localeFile(tree, REFERENCE_LOCALE);
    const baseFlat = flattenText(baseSource.read(file));
    const headFlat = flattenText(headSource.read(file));
    if (baseFlat === null || headFlat === null) continue;

    diffReferenceTree(tree.name, baseFlat, headFlat, delta);
  }

  return delta;
}

function placeholdersDiffer(first, second) {
  const normalize = (value) =>
    typeof value === "string"
      ? [...value.matchAll(/\{\{([^{}]*)\}\}/g)]
          .map((match) => match[1].replaceAll(/\s+/g, ""))
          .sort((a, b) => a.localeCompare(b))
          .join("|")
      : "";

  return normalize(first) !== normalize(second);
}

function isExemptForUntouchedLocale(finding, delta) {
  const scoped = `${finding.tree}|${finding.key}`;

  if (finding.kind === "missing") return delta.added.has(scoped);
  if (finding.kind === "extra") return delta.removed.has(scoped);
  if (finding.kind === "placeholder") {
    return delta.added.has(scoped) || delta.placeholderChanged.has(scoped);
  }

  return false;
}

function touchedLocales(baseSource, headSource) {
  const touched = new Set();

  for (const tree of TREES) {
    for (const locale of headSource.listLocales(tree.dir) ?? []) {
      const file = localeFile(tree, locale);

      if (baseSource.read(file) !== headSource.read(file)) {
        touched.add(`${tree.name}|${locale}`);
      }
    }
  }

  return touched;
}

function groupCounts(findings) {
  const counts = new Map();

  for (const finding of findings) {
    const scope = `${finding.tree}/${finding.scope}`;
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
    const title = `locale ${finding.kind}: ${finding.tree}/${finding.scope}`;
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

  return ["| scope | problems |", "| --- | --- |", ...rows, ""];
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

function renderSection(title, findings, note) {
  if (findings.length === 0) return [];

  return [
    `### ${title}`,
    "",
    ...(note ? [note, ""] : []),
    ...summaryTable(findings),
    ...summaryDetails(findings),
  ];
}

function writeList(findings) {
  for (const finding of findings.slice(0, SUMMARY_LIMIT)) {
    process.stdout.write(`  ${describe(finding)}\n`);
  }

  if (findings.length > SUMMARY_LIMIT) {
    process.stdout.write(`  ... and ${findings.length - SUMMARY_LIMIT} more\n`);
  }
}

function advisoryNote(usage) {
  if (usage === undefined || usage.dynamic.size === 0) return null;

  return `Unused keys are approximate. These namespaces contain fully dynamic \`t()\` lookups that no static pass can resolve, so keys in them may be used after all: ${[...usage.dynamic].sort(byText).join(", ")}.`;
}

function summaryFor(introduced, advisory, inherited, baseLabel, usage) {
  const failing = introduced.length > 0;

  return [
    failing ? "## Locale check failed" : "## Locale check",
    "",
    failing
      ? `**${introduced.length}** problems introduced by this change.`
      : "No new locale problems introduced.",
    "",
    `**${inherited}** pre-existing problems inherited from ${baseLabel}, not blocking.`,
    "",
    ...renderSection("Introduced by this change", introduced, null),
    ...renderSection(
      "Advisory",
      advisory,
      advisoryNote(usage) ?? "Not blocking, listed so the gap stays visible."
    ),
  ].join("\n");
}

function writeOutcome(introduced, advisory, inherited, baseLabel) {
  if (introduced.length > 0) {
    process.stdout.write(
      `\n${introduced.length} locale problems introduced by this change:\n\n`
    );
    writeList(introduced);
  } else {
    process.stdout.write(
      `No new locale problems. ${inherited} pre-existing problems inherited from ${baseLabel}.\n`
    );
  }

  if (advisory.length > 0) {
    process.stdout.write(`\n${advisory.length} advisory findings:\n\n`);
    writeList(advisory);
  }

  if (introduced.length > 0) {
    process.stdout.write(
      `\n${inherited} pre-existing problems were inherited and are not blocking.\n`
    );
  }
}

function report(introduced, advisory, inherited, baseLabel, usage) {
  annotate(introduced);
  annotate(advisory, "warning");
  writeSummary(summaryFor(introduced, advisory, inherited, baseLabel, usage));
  writeOutcome(introduced, advisory, inherited, baseLabel);

  return introduced.length > 0 ? 1 : 0;
}

function reportOnly(head) {
  process.stdout.write(
    "No base locales to compare against, reporting only.\n\n"
  );

  for (const { scope, detail } of countedScopes(head.findings)) {
    process.stdout.write(`  ${scope}  ${detail}\n`);
  }

  process.stdout.write(`\n${head.findings.length} locale problems in total.\n`);
  writeSummary(
    [
      "## Locale report",
      "",
      ...renderSection("All findings", head.findings, advisoryNote(head.usage)),
    ].join("\n")
  );

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

function localeFlatsOf(source, tree) {
  const flats = new Map();

  for (const locale of source.listLocales(tree.dir) ?? []) {
    const flat = flattenText(source.read(localeFile(tree, locale)));
    if (flat !== null) flats.set(locale, flat);
  }

  return flats;
}

function classifyFinding(finding, context) {
  if (finding.advisory) return "advisory";
  if (!context.baseHasSource && SOURCE_KINDS.has(finding.kind)) {
    return "advisory";
  }

  const scope = `${finding.tree}|${finding.scope}`;
  const isOwned = !context.baseScopes.has(scope) || context.touched.has(scope);

  if (context.baseIds.has(finding.id)) {
    return isOwned && finding.kind === "missing"
      ? "inheritedAdvisory"
      : "inherited";
  }

  if (!isOwned && isExemptForUntouchedLocale(finding, context.delta)) {
    return finding.kind === "placeholder" ? "drift" : "exempt";
  }

  return "introduced";
}

function partitionFindings(findings, context) {
  const introduced = [];
  const advisory = [];
  const drift = [];
  let inherited = 0;

  const buckets = {
    introduced,
    advisory,
    drift,
    inherited: () => (inherited += 1),
    inheritedAdvisory: (finding) => {
      inherited += 1;
      advisory.push(finding);
    },
  };

  for (const finding of findings) {
    const bucket = classifyFinding(finding, context);

    if (bucket === "exempt") continue;
    if (bucket === "inherited") buckets.inherited();
    else if (bucket === "inheritedAdvisory") buckets.inheritedAdvisory(finding);
    else buckets[bucket].push(finding);
  }

  return { introduced, advisory, drift, inherited };
}

function collectAdvisories(advisory, drift, delta) {
  advisory.push(...aggregatePlaceholderDrift(drift));

  for (const tree of TREES) {
    const removedKeys = delta.removedByTree.get(tree.name);
    if (removedKeys === undefined || removedKeys.size === 0) continue;

    reportRenames(tree, removedKeys, localeFlatsOf(workingTree, tree), {
      push: (finding) => advisory.push({ ...finding, tree: tree.name }),
    });
  }

  advisory.sort(byAdvisoryPriority);
}

function ratchet(head, baseSource, baseLabel, baseHasSource) {
  const base = collectFindings(baseSource, { withSource: baseHasSource });
  const delta = referenceDelta(baseSource, workingTree);

  const { introduced, advisory, drift, inherited } = partitionFindings(
    head.findings,
    {
      baseHasSource,
      baseScopes: base.scopes,
      baseIds: new Set(base.findings.map((finding) => finding.id)),
      touched: touchedLocales(baseSource, workingTree),
      delta,
    }
  );

  collectAdvisories(advisory, drift, delta);

  return report(introduced, advisory, inherited, baseLabel, head.usage);
}

function main() {
  const withSource = workingTree.exists("src/renderer/src");
  const head = collectFindings(workingTree, { withSource });
  const unparseable = head.findings.filter(
    (finding) => finding.kind === "parse-error"
  );

  if (unparseable.length > 0) {
    annotate(unparseable);
    process.stdout.write("A locale file could not be parsed.\n");

    return 1;
  }

  const baseDir = readOption("--base-dir", "LOCALE_CHECK_BASE_DIR");
  if (!baseDir) return reportOnly(head);

  const baseSource = fileTree(baseDir);
  const hasBaseLocales = TREES.some(
    (tree) => baseSource.listLocales(tree.dir) !== null
  );

  if (!hasBaseLocales) {
    process.stdout.write(
      `::warning::no locale directories found under ${baseDir}, falling back to a report\n`
    );

    return reportOnly(head);
  }

  const baseLabel =
    readOption("--base-label", "LOCALE_CHECK_BASE_LABEL") || "the base branch";
  const baseHasSource = baseSource.exists("src/renderer/src");

  if (withSource && !baseHasSource) {
    process.stdout.write(
      "::warning::the base revision has no source tree, source checks cannot be ratcheted and are reported as advisory\n"
    );
  }

  return ratchet(head, baseSource, baseLabel, baseHasSource);
}

process.exitCode = main();
