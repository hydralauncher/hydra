// Fails when the renderer uses a `window.electron` member that the installed
// app it is served to doesn't have.
//
// App vX.Y.Z loads its renderer over the air from the `release/vX.Y.Z` deploy,
// but keeps the preload and main process shipped in tag vX.Y.Z, so any bridge
// member added after that tag is undefined for its users.
//
// A missing member is allowed where it can't throw: `x?.()`, `typeof x`, or
// code that only runs once a check like `typeof x === "function"` has passed
// (inside `if`, `?:` or `&&`, or after an early return).
//
// Only member names are compared. A member whose parameters or behavior
// changed after that tag, like `getLibrary(true)` against an older
// `getLibrary()`, still passes.
//
// Usage: node scripts/check-ota-bridge.mjs [--base <git-ref> | --branch <name>]
// --base defaults to v<package.json version>. --branch takes a release branch,
// and both release/4.1.5 and release/v4.1.5 mean v4.1.5. The check is skipped
// with a warning when that ref doesn't exist yet, i.e. nothing has shipped for
// it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const { SyntaxKind } = ts;

const PRELOAD_PATH = "src/preload/index.ts";

// big-picture ships inside the renderer bundle (see src/renderer/src/main.tsx).
const SOURCE_ROOTS = ["src/renderer/src", "src/big-picture/src"];

const BRIDGE_ROOTS = new Set([
  "window.electron",
  "globalThis.window.electron",
  "globalThis.electron",
]);

// Refs come from the command line, so one starting with "-" must not reach git
// as an option.
const GIT_REF = /^\w[\w./~^-]*$/;

const EQUALITY_OPERATORS = new Set([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);

const LOGICAL_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }); // NOSONAR - build script run with the CI image's git; refs are validated and passed after --end-of-options

// release/4.1.5 and release/v4.1.5 both deploy the renderer for tag v4.1.5.
export const baseRefForBranch = (branch) => {
  const match = /^release\/v?(\d+\.\d+\.\d+[\w.-]*)$/.exec(branch);
  if (!match) {
    throw new Error(`"${branch}" is not a release/<version> branch`);
  }
  return `v${match[1]}`;
};

const getBaseRef = () => {
  const { values } = parseArgs({
    options: { base: { type: "string" }, branch: { type: "string" } },
  });
  if (values.base && values.branch) {
    throw new Error("Pass --base or --branch, not both");
  }

  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const ref = values.branch
    ? baseRefForBranch(values.branch)
    : (values.base ?? `v${version}`);

  if (!GIT_REF.test(ref)) throw new Error(`Invalid git ref "${ref}"`);
  return ref;
};

const refExists = (ref) => {
  try {
    git(
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${ref}^{commit}`
    );
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

const isWrapper = (node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node);

const unwrap = (node) => (isWrapper(node) ? unwrap(node.expression) : node);

// The outermost of the parens, `as` and `!` wrapped around node, if any.
const wrapped = (node) =>
  isWrapper(node.parent) ? wrapped(node.parent) : node;

const isAccess = (node) =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);

// The name `x.name` or `x["name"]` reads, or null for anything else.
const accessName = (node) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
};

// `globalThis.window?.electron` -> "globalThis.window.electron", or null when
// the expression isn't a plain chain of names.
const dottedName = (node) => {
  node = unwrap(node);
  if (ts.isIdentifier(node)) return node.text;

  const name = accessName(node);
  const object = name === null ? null : dottedName(node.expression);
  return object && `${object}.${name}`;
};

const isScope = (node) =>
  ts.isBlock(node) ||
  ts.isSourceFile(node) ||
  ts.isModuleBlock(node) ||
  ts.isCaseOrDefaultClause(node);

const scopeOf = (node) => (isScope(node) ? node : scopeOf(node.parent));

// Whether statement always leaves the code that follows it.
const exits = (statement) =>
  ts.isReturnStatement(statement) ||
  ts.isThrowStatement(statement) ||
  ts.isBreakStatement(statement) ||
  ts.isContinueStatement(statement) ||
  (ts.isBlock(statement) && statement.statements.some(exits)) ||
  (ts.isIfStatement(statement) &&
    statement.elseStatement !== undefined &&
    exits(statement.thenStatement) &&
    exits(statement.elseStatement));

// Whether reading node is harmless when it is undefined: `x?.()`, `x?.y`,
// `typeof x`, `!x`, `x == null`, `x && ...` or `if (x)`.
const toleratesMissing = (node) => {
  node = wrapped(node);
  const { parent } = node;

  if (
    (isAccess(parent) || ts.isCallExpression(parent)) &&
    parent.expression === node
  ) {
    return Boolean(parent.questionDotToken);
  }
  if (ts.isTypeOfExpression(parent)) return true;
  if (ts.isPrefixUnaryExpression(parent)) {
    return parent.operator === SyntaxKind.ExclamationToken;
  }
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    if (EQUALITY_OPERATORS.has(operator)) return true;
    return (
      LOGICAL_OPERATORS.has(operator) &&
      (node === parent.left || toleratesMissing(parent))
    );
  }
  if (ts.isConditionalExpression(parent)) return parent.condition === node;
  return (
    (ts.isIfStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent)) &&
    parent.expression === node
  );
};

// Members of the object passed to `exposeInMainWorld("electron", ...)`, as
// Map<name, Map | null>: nested objects like `leveldb` are Maps, the rest are
// leaves.
export const readBridgeMembers = (fileName, text) => {
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
      .sort((a, b) => a.localeCompare(b))
      .map((file) => path.join(root, file))
  );

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

const covers = (member, key) =>
  member !== null && (member === key || member.startsWith(`${key}.`));

// Uses of bridge members missing from `members` in a file, as
// { missing: "leveldb.get", guarded, location }.
export const findMissingUsages = (fileName, source, members) => {
  if (!source.includes("electron")) return [];

  const sourceFile = parse(fileName, source);
  const aliases = new Set();
  const locals = new Map();
  const bindings = [];
  const usages = [];

  const isBridge = (node) => {
    const name = dottedName(node);
    return BRIDGE_ROOTS.has(name) || aliases.has(name);
  };

  // The bridge member an expression reads ("leveldb.get"), or null.
  const memberOf = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return locals.get(node.text) ?? null;

    const name = accessName(node);
    if (name === null) return null;
    if (isBridge(node.expression)) return name;

    const object = memberOf(node.expression);
    return object && `${object}.${name}`;
  };

  // Whether `condition` evaluating to `outcome` means `key` exists.
  const implies = (condition, key, outcome) => {
    condition = unwrap(condition);

    if (
      ts.isPrefixUnaryExpression(condition) &&
      condition.operator === SyntaxKind.ExclamationToken
    ) {
      return implies(condition.operand, key, !outcome);
    }

    // if (window.electron.x)
    if (!ts.isBinaryExpression(condition)) {
      return outcome && covers(memberOf(condition), key);
    }

    const { left, right } = condition;
    const operator = condition.operatorToken.kind;
    const either = (value) =>
      implies(left, key, value) || implies(right, key, value);
    const both = (value) =>
      implies(left, key, value) && implies(right, key, value);

    if (operator === SyntaxKind.AmpersandAmpersandToken) {
      return outcome ? either(true) : both(false);
    }
    if (operator === SyntaxKind.BarBarToken) {
      return outcome ? both(true) : either(false);
    }

    // "x" in window.electron
    if (operator === SyntaxKind.InKeyword) {
      if (!outcome || !ts.isStringLiteralLike(left)) return false;
      const object = isBridge(right) ? "" : memberOf(right);
      return (
        object !== null &&
        covers(object ? `${object}.${left.text}` : left.text, key)
      );
    }

    if (!EQUALITY_OPERATORS.has(operator)) return false;

    const isEqual =
      outcome !==
      (operator === SyntaxKind.ExclamationEqualsToken ||
        operator === SyntaxKind.ExclamationEqualsEqualsToken);
    const isStrict =
      operator === SyntaxKind.EqualsEqualsEqualsToken ||
      operator === SyntaxKind.ExclamationEqualsEqualsToken;

    for (const [subject, value] of [
      [unwrap(left), unwrap(right)],
      [unwrap(right), unwrap(left)],
    ]) {
      // typeof x === "function", typeof x !== "undefined"
      if (ts.isTypeOfExpression(subject) && ts.isStringLiteralLike(value)) {
        return (
          isEqual === (value.text !== "undefined") &&
          covers(memberOf(subject.expression), key)
        );
      }

      // x != null, x !== undefined
      const isUndefined = ts.isIdentifier(value) && value.text === "undefined";
      const isNull = value.kind === SyntaxKind.NullKeyword;
      if (isUndefined || (isNull && !isStrict)) {
        return !isEqual && covers(memberOf(subject), key);
      }
    }

    return false;
  };

  // `if (!check) return;`, or `if (check) { ... } else return;`.
  const exitsUnless = (statement, key) =>
    ts.isIfStatement(statement) &&
    ((exits(statement.thenStatement) &&
      implies(statement.expression, key, false)) ||
      (statement.elseStatement !== undefined &&
        exits(statement.elseStatement) &&
        implies(statement.expression, key, true)));

  // Whether node only runs once a check like `typeof x === "function"` has
  // passed for `key`. Bridge members never change, so a check outside a
  // callback still covers the callback.
  const isGuarded = (node, key) => {
    for (let child = node; child.parent; child = child.parent) {
      const { parent } = child;

      if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) {
        const isIf = ts.isIfStatement(parent);
        const condition = isIf ? parent.expression : parent.condition;
        const whenTrue = isIf ? parent.thenStatement : parent.whenTrue;
        const whenFalse = isIf ? parent.elseStatement : parent.whenFalse;
        if (child === whenTrue && implies(condition, key, true)) return true;
        if (child === whenFalse && implies(condition, key, false)) return true;
      } else if (ts.isBinaryExpression(parent) && child === parent.right) {
        const operator = parent.operatorToken.kind;
        if (
          operator === SyntaxKind.AmpersandAmpersandToken &&
          implies(parent.left, key, true)
        ) {
          return true;
        }
        if (
          operator === SyntaxKind.BarBarToken &&
          implies(parent.left, key, false)
        ) {
          return true;
        }
      } else if (isScope(parent)) {
        const index = parent.statements.indexOf(child);
        if (
          index > 0 &&
          parent.statements
            .slice(0, index)
            .some((statement) => exitsUnless(statement, key))
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const locate = (node) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    return `${fileName.replaceAll("\\", "/")}:${line + 1}:${character + 1}`;
  };

  const addUsage = (node, missing) => {
    usages.push({
      missing,
      guarded: toleratesMissing(node) || isGuarded(node, missing),
      location: locate(node),
    });
  };

  // Checks the member `start` reads, extended by the `.a.b` accesses on it.
  const checkChain = (start, member) => {
    const startDepth = member.split(".").length;
    const chain = [start];

    for (;;) {
      const node = wrapped(chain.at(-1));
      const name =
        node.parent.expression === node ? accessName(node.parent) : null;
      if (name === null) break;
      chain.push(node.parent);
      member += `.${name}`;
    }

    const missing = findMissing(members, member);
    if (!missing) return;

    // A missing part shorter than what `start` reads was reported where
    // `start` got its value.
    const index = missing.split(".").length - startDepth;
    if (index < 0) return;

    const target = chain[index];
    usages.push({
      missing,
      guarded: toleratesMissing(target) || isGuarded(target, missing),
      location: locate(start),
    });
  };

  // const { getVersion } = window.electron; -> getVersion reads "getVersion".
  const bind = (pattern, prefix, scope) => {
    for (const element of pattern.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (element.dotDotDotToken || name === undefined) continue;

      const member = prefix ? `${prefix}.${name}` : name;

      if (ts.isObjectBindingPattern(element.name)) {
        // Destructuring a missing object throws, unless it has a default.
        if (!element.initializer && findMissing(members, member) === member) {
          addUsage(element, member);
        }
        bind(element.name, member, scope);
      } else if (ts.isIdentifier(element.name) && !element.initializer) {
        locals.set(element.name.text, member);
        bindings.push({ name: element.name.text, member, scope });
      }
    }
  };

  // Aliases first, so uses above their declaration are found too.
  forEachNode(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.name) &&
      isBridge(node.initializer)
    ) {
      aliases.add(node.name.text);
    }
  });

  forEachNode(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const prefix = isBridge(node.initializer)
        ? ""
        : memberOf(node.initializer);
      if (prefix !== null) bind(node.name, prefix, scopeOf(node));
    }
  });

  // window.electron.leveldb.get(...)
  forEachNode(sourceFile, (node) => {
    const name = accessName(node);
    if (name !== null && isBridge(node.expression)) checkChain(node, name);
  });

  // getVersion() after `const { getVersion } = window.electron`. Only calls
  // and accesses can throw; a missing local just reads as undefined.
  for (const { name, member, scope } of bindings) {
    forEachNode(scope, (node) => {
      if (!ts.isIdentifier(node) || node.text !== name) return;

      const outer = wrapped(node);
      if (
        (isAccess(outer.parent) || ts.isCallExpression(outer.parent)) &&
        outer.parent.expression === outer
      ) {
        checkChain(node, member);
      }
    });
  }

  return usages;
};

const print = (usages, log) => {
  const byMember = Map.groupBy(usages, (usage) => usage.missing);
  for (const member of [...byMember.keys()].sort((a, b) =>
    a.localeCompare(b)
  )) {
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
  const members = readBridgeMembers(
    preloadRef,
    git("show", "--end-of-options", preloadRef)
  );

  const missing = listSourceFiles().flatMap((file) =>
    findMissingUsages(file, fs.readFileSync(file, "utf8"), members)
  );

  const warnings = missing.filter((usage) => usage.guarded);
  const errors = missing.filter((usage) => !usage.guarded);

  if (warnings.length > 0) {
    console.warn(
      `[ota-bridge] Guarded members missing from ${baseRef} (allowed):`
    );
    print(warnings, console.warn);
  }

  if (errors.length > 0) {
    console.error(
      [
        `[ota-bridge] The renderer uses window.electron members that do not exist in the preload shipped with ${baseRef}.`,
        `Users on ${baseRef} would get "is not a function" errors after this OTA deploy.`,
        `Remove these uses, ship them in a new app release, or guard them: call with \`?.()\`, or only after a \`typeof window.electron.x === "function"\` check:`,
      ].join("\n")
    );
    print(errors, console.error);
    process.exit(1);
  }

  console.log(
    `[ota-bridge] OK: every window.electron member used by the renderer exists in ${baseRef}.`
  );
};

// Run only as a script, not when imported by the tests.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  main();
}
