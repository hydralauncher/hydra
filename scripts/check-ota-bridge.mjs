// Fails when the renderer uses a `window.electron` member that the installed
// app it is served to doesn't have.
//
// App vX.Y.Z loads its renderer over the air from the `release/vX.Y.Z` deploy,
// but keeps the preload and main process shipped in tag vX.Y.Z, so any bridge
// member added after that tag is undefined for its users.
//
// Usage: node scripts/check-ota-bridge.mjs [--base <git-ref>]
// --base defaults to v<package.json version>. The check is skipped with a
// warning when that ref doesn't exist yet, i.e. nothing has shipped for it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";

const PRELOAD_PATH = "src/preload/index.ts";

// big-picture ships inside the renderer bundle (see src/renderer/src/main.tsx).
const SOURCE_ROOTS = ["src/renderer/src", "src/big-picture/src"];

const BRIDGE_ROOTS = new Set([
  "window.electron",
  "globalThis.window.electron",
  "globalThis.electron",
]);

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });

const getBaseRef = () => {
  const { values } = parseArgs({ options: { base: { type: "string" } } });
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return values.base ?? `v${version}`;
};

const refExists = (ref) => {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const parse = (fileName, text) =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

const forEachNode = (node, callback) => {
  callback(node);
  ts.forEachChild(node, (child) => forEachNode(child, callback));
};

const unwrap = (node) =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    ? unwrap(node.expression)
    : node;

// `globalThis.window?.electron` -> "globalThis.window.electron", or null when
// the expression isn't a plain chain of names.
const dottedName = (node) => {
  node = unwrap(node);
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node)) return null;

  const object = dottedName(node.expression);
  return object && `${object}.${node.name.text}`;
};

// Members of the object passed to `exposeInMainWorld("electron", ...)`, as
// Map<name, Map | null>: nested objects like `leveldb` are Maps, the rest are
// leaves.
const readBridgeMembers = (fileName, text) => {
  const sourceFile = parse(fileName, text);

  // For resolving spreads like `...fileExplorerApi`.
  const topLevelObjects = new Map(
    sourceFile.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .filter(
        ({ initializer }) =>
          initializer && ts.isObjectLiteralExpression(initializer)
      )
      .map(({ name, initializer }) => [name.getText(sourceFile), initializer])
  );

  const addMembers = (object, members = new Map()) => {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = property.expression.getText(sourceFile);
        if (!topLevelObjects.has(spread)) {
          throw new Error(`${fileName}: cannot resolve "...${spread}"`);
        }
        addMembers(topLevelObjects.get(spread), members);
      } else if (property.name?.text) {
        const isNested =
          ts.isPropertyAssignment(property) &&
          ts.isObjectLiteralExpression(property.initializer);
        members.set(
          property.name.text,
          isNested ? addMembers(property.initializer) : null
        );
      }
    }
    return members;
  };

  const findBridge = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).endsWith("exposeInMainWorld")
    ) {
      const [name, api] = node.arguments;
      if (name && ts.isStringLiteral(name) && name.text === "electron") {
        return api;
      }
    }
    return ts.forEachChild(node, findBridge);
  };

  const bridge = findBridge(sourceFile);
  if (!bridge || !ts.isObjectLiteralExpression(bridge)) {
    throw new Error(
      `${fileName}: exposeInMainWorld("electron", { ... }) not found`
    );
  }

  return addMembers(bridge);
};

const listSourceFiles = () =>
  SOURCE_ROOTS.flatMap((root) =>
    fs
      .readdirSync(root, { recursive: true })
      .filter(
        (file) =>
          /\.tsx?$/.test(file) && !/\.(d|test|spec|stories)\.tsx?$/.test(file)
      )
      .sort()
      .map((file) => path.join(root, file))
  );

// `typeof window.electron.x === "function"` or `window.electron.x?.()`.
const isFeatureDetected = (access) =>
  ts.isTypeOfExpression(access.parent) ||
  (ts.isCallExpression(access.parent) &&
    access.parent.expression === access &&
    Boolean(access.parent.questionDotToken));

// Bridge members a file uses ("getVersion", "leveldb.get") and where.
const collectUsages = (fileName) => {
  const source = fs.readFileSync(fileName, "utf8");
  if (!source.includes("electron")) return [];

  const sourceFile = parse(fileName, source);
  const aliases = new Set();
  const usages = [];

  const isBridge = (node) => {
    const name = dottedName(node);
    return BRIDGE_ROOTS.has(name) || aliases.has(name);
  };

  // The left side of `const <binding> = window.electron`, if node is one.
  const bridgeBinding = (node) =>
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    isBridge(node.initializer)
      ? node.name
      : undefined;

  const addUsage = (member, node, featureDetected = false) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    const file = fileName.replaceAll("\\", "/");
    usages.push({
      member,
      featureDetected,
      location: `${file}:${line + 1}:${character + 1}`,
    });
  };

  // Aliases first, so uses above their declaration are found too.
  forEachNode(sourceFile, (node) => {
    const binding = bridgeBinding(node);
    if (binding && ts.isIdentifier(binding)) aliases.add(binding.text);
  });

  forEachNode(sourceFile, (node) => {
    // const { getVersion } = window.electron;
    const binding = bridgeBinding(node);
    if (binding && ts.isObjectBindingPattern(binding)) {
      for (const element of binding.elements) {
        const member = (element.propertyName ?? element.name).text;
        if (member && !element.dotDotDotToken) addUsage(member, element);
      }
    }

    // window.electron.leveldb.get(...) -> "leveldb.get"
    if (ts.isPropertyAccessExpression(node) && isBridge(node.expression)) {
      let access = node;
      let member = node.name.text;
      while (
        ts.isPropertyAccessExpression(access.parent) &&
        access.parent.expression === access
      ) {
        access = access.parent;
        member += `.${access.name.text}`;
      }
      addUsage(member, node, isFeatureDetected(access));
    }
  });

  // A member feature-detected anywhere in the file counts as detected in all
  // of it, since the check and the call are often in different functions.
  const detected = new Set(
    usages.filter((usage) => usage.featureDetected).map((usage) => usage.member)
  );
  return usages.map((usage) => ({
    ...usage,
    featureDetected: detected.has(usage.member),
  }));
};

// The part of `member` the bridge doesn't have, or null when it exists.
// Anything past a leaf (like `fn.bind`) belongs to the member, not the bridge.
const findMissing = (members, member) => {
  const segments = member.split(".");
  let current = members;

  for (const [index, segment] of segments.entries()) {
    if (!current.has(segment)) return segments.slice(0, index + 1).join(".");
    current = current.get(segment);
    if (current === null) return null;
  }

  return null;
};

const print = (usages, log) => {
  const byMember = Map.groupBy(usages, (usage) => usage.missing);
  for (const member of [...byMember.keys()].sort()) {
    log(`  window.electron.${member}`);
    for (const { location } of byMember.get(member)) log(`    at ${location}`);
  }
};

const main = () => {
  const baseRef = getBaseRef();

  if (!refExists(baseRef)) {
    console.log(
      `::warning::[ota-bridge] Base ref "${baseRef}" not found, nothing has shipped for this release yet. Skipping.`
    );
    return;
  }

  const preloadRef = `${baseRef}:${PRELOAD_PATH}`;
  const members = readBridgeMembers(preloadRef, git("show", preloadRef));

  const missing = listSourceFiles()
    .flatMap(collectUsages)
    .map((usage) => ({ ...usage, missing: findMissing(members, usage.member) }))
    .filter((usage) => usage.missing);

  const warnings = missing.filter((usage) => usage.featureDetected);
  const errors = missing.filter((usage) => !usage.featureDetected);

  if (warnings.length > 0) {
    console.warn(
      `[ota-bridge] Feature-detected members missing from ${baseRef} (allowed):`
    );
    print(warnings, console.warn);
  }

  if (errors.length > 0) {
    console.error(
      [
        `[ota-bridge] The renderer uses window.electron members that do not exist in the preload shipped with ${baseRef}.`,
        `Users on ${baseRef} would get "is not a function" errors after this OTA deploy.`,
        `Remove these calls, ship them in a new app release, or guard them with \`typeof window.electron.x === "function"\`:`,
      ].join("\n")
    );
    print(errors, console.error);
    process.exit(1);
  }

  console.log(
    `[ota-bridge] OK: every window.electron member used by the renderer exists in ${baseRef}.`
  );
};

main();
