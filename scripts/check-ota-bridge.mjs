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
  const match = /^release\/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(branch);
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

// The identifiers a binding declares: `x`, or each name in `{ x, y: [z] }`.
const declaredIdentifiers = (name) =>
  ts.isIdentifier(name)
    ? [name]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : declaredIdentifiers(element.name)
      );

const declaredInList = (list) =>
  list.declarations.flatMap(({ name }) => declaredIdentifiers(name));

const declaredInStatement = (statement) => {
  if (ts.isVariableStatement(statement)) {
    return declaredInList(statement.declarationList);
  }
  const isNamed =
    ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement);
  return isNamed && statement.name ? [statement.name] : [];
};

// The identifiers node declares for the code inside it.
const declaredIn = (node) => {
  if (isScope(node)) return node.statements.flatMap(declaredInStatement);
  if (ts.isFunctionLike(node)) {
    return node.parameters.flatMap(({ name }) => declaredIdentifiers(name));
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    return declaredIdentifiers(node.variableDeclaration.name);
  }
  const isLoop =
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node);
  return isLoop &&
    node.initializer &&
    ts.isVariableDeclarationList(node.initializer)
    ? declaredInList(node.initializer)
    : [];
};

const declarationCache = new WeakMap();

// The declaration `identifier` refers to: its name in the nearest scope
// around it that declares one.
const declarationOf = (identifier) => {
  for (let node = identifier.parent; node; node = node.parent) {
    if (!declarationCache.has(node)) {
      declarationCache.set(node, declaredIn(node));
    }
    const declaration = declarationCache
      .get(node)
      .find(({ text }) => text === identifier.text);
    if (declaration) return declaration;
  }
  return undefined;
};

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

// `x()` or `x.y`, the uses that throw when x is undefined.
const isCalledOrAccessed = (node) => {
  node = wrapped(node);
  return (
    (isAccess(node.parent) || ts.isCallExpression(node.parent)) &&
    node.parent.expression === node
  );
};

// Whether reading node is harmless when it is undefined: `x?.()`, `x?.y`,
// `typeof x`, `!x`, `x == null`, `x && ...` or `if (x)`.
const toleratesMissing = (node) => {
  if (isCalledOrAccessed(node)) {
    return Boolean(wrapped(node).parent.questionDotToken);
  }

  node = wrapped(node);
  const { parent } = node;

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

// `x === y` and `x !== y` style operators.
const NEGATED_OPERATORS = new Set([
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);

const STRICT_OPERATORS = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);

const isNegation = (node) =>
  ts.isPrefixUnaryExpression(node) &&
  node.operator === SyntaxKind.ExclamationToken;

const isUndefinedLiteral = (node) =>
  ts.isIdentifier(node) && node.text === "undefined";

// `window.electron.newApi ?? {}` reads newApi without throwing when it's missing.
const destructuringSource = (initializer) => {
  const node = unwrap(initializer);
  const hasDefault =
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === SyntaxKind.BarBarToken);
  return hasDefault
    ? { source: node.left, hasDefault }
    : { source: node, hasDefault };
};

// Uses of bridge members missing from `members` in a file, as
// { missing: "leveldb.get", guarded, location }.
export const findMissingUsages = (fileName, source, members) => {
  if (!source.includes("electron")) return [];

  const sourceFile = parse(fileName, source);
  // Declarations of `const electron = window.electron`.
  const aliases = new Set();
  // Declarations of `const { getVersion } = window.electron`, to the member.
  const locals = new Map();
  // Their names, so only identifiers that may be one get resolved.
  const names = new Set();
  const usages = [];

  const bindingOf = (node) =>
    ts.isIdentifier(node) && names.has(node.text)
      ? declarationOf(node)
      : undefined;

  const isBridge = (node) => {
    node = unwrap(node);
    return ts.isIdentifier(node)
      ? aliases.has(bindingOf(node))
      : BRIDGE_ROOTS.has(dottedName(node));
  };

  // The bridge member an expression reads ("leveldb.get"), or null.
  const memberOf = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return locals.get(bindingOf(node)) ?? null;

    const name = accessName(node);
    if (name === null) return null;
    if (isBridge(node.expression)) return name;

    const object = memberOf(node.expression);
    return object && `${object}.${name}`;
  };

  const covers = (node, key) => {
    const member = memberOf(node);
    return member !== null && (member === key || member.startsWith(`${key}.`));
  };

  // "x" in window.electron
  const inImplies = ({ left, right }, key) => {
    if (!ts.isStringLiteralLike(left)) return false;
    const object = isBridge(right) ? "" : memberOf(right);
    if (object === null) return false;

    const member = object ? `${object}.${left.text}` : left.text;
    return member === key || member.startsWith(`${key}.`);
  };

  // typeof x === "function", typeof x !== "undefined", x != null,
  // x !== undefined.
  const comparisonImplies = (condition, key, outcome) => {
    const operator = condition.operatorToken.kind;
    if (!EQUALITY_OPERATORS.has(operator)) return false;

    const isEqual = outcome !== NEGATED_OPERATORS.has(operator);
    const isStrict = STRICT_OPERATORS.has(operator);
    const left = unwrap(condition.left);
    const right = unwrap(condition.right);

    for (const [subject, value] of [
      [left, right],
      [right, left],
    ]) {
      if (ts.isTypeOfExpression(subject) && ts.isStringLiteralLike(value)) {
        const isDefined = isEqual === (value.text !== "undefined");
        return isDefined && covers(subject.expression, key);
      }

      const isNull = value.kind === SyntaxKind.NullKeyword && !isStrict;
      if (isNull || isUndefinedLiteral(value)) {
        return !isEqual && covers(subject, key);
      }
    }

    return false;
  };

  // Whether `condition` evaluating to `outcome` means `key` exists.
  const implies = (condition, key, outcome) => {
    condition = unwrap(condition);

    if (isNegation(condition)) return implies(condition.operand, key, !outcome);

    // if (window.electron.x)
    if (!ts.isBinaryExpression(condition)) {
      return outcome && covers(condition, key);
    }

    const operator = condition.operatorToken.kind;
    const isAnd = operator === SyntaxKind.AmpersandAmpersandToken;

    if (isAnd || operator === SyntaxKind.BarBarToken) {
      const left = implies(condition.left, key, outcome);
      const right = implies(condition.right, key, outcome);
      // `a && b` passing means both passed, and `a || b` failing means both
      // failed, so one of them is enough. Otherwise it takes both.
      return outcome === isAnd ? left || right : left && right;
    }

    if (operator === SyntaxKind.InKeyword) {
      return outcome && inImplies(condition, key);
    }

    return comparisonImplies(condition, key, outcome);
  };

  // `if (!check) return;`, or `if (check) { ... } else return;`.
  const exitsUnless = (statement, key) => {
    if (!ts.isIfStatement(statement)) return false;

    const { expression, thenStatement, elseStatement } = statement;
    if (exits(thenStatement) && implies(expression, key, false)) return true;
    return (
      elseStatement !== undefined &&
      exits(elseStatement) &&
      implies(expression, key, true)
    );
  };

  // `child` is the branch taken when `condition` passed or failed.
  const branchGuards = (condition, whenTrue, whenFalse, child, key) =>
    (child === whenTrue && implies(condition, key, true)) ||
    (child === whenFalse && implies(condition, key, false));

  // check && x(), !check || x()
  const operandGuards = (expression, child, key) => {
    const operator = expression.operatorToken.kind;
    const isAnd = operator === SyntaxKind.AmpersandAmpersandToken;
    return (
      child === expression.right &&
      (isAnd || operator === SyntaxKind.BarBarToken) &&
      implies(expression.left, key, isAnd)
    );
  };

  // if (!check) return; x();
  const earlierStatementsGuard = (statements, child, key) => {
    const index = statements.indexOf(child);
    return (
      index > 0 &&
      statements
        .slice(0, index)
        .some((statement) => exitsUnless(statement, key))
    );
  };

  // Whether `parent` only runs `child` once a check on `key` has passed.
  const parentGuards = (parent, child, key) => {
    if (ts.isIfStatement(parent)) {
      const { expression, thenStatement, elseStatement } = parent;
      return branchGuards(expression, thenStatement, elseStatement, child, key);
    }
    if (ts.isConditionalExpression(parent)) {
      const { condition, whenTrue, whenFalse } = parent;
      return branchGuards(condition, whenTrue, whenFalse, child, key);
    }
    if (ts.isBinaryExpression(parent)) return operandGuards(parent, child, key);
    if (isScope(parent)) {
      return earlierStatementsGuard(parent.statements, child, key);
    }
    return false;
  };

  // Whether node only runs once a check like `typeof x === "function"` has
  // passed for `key`. Bridge members never change, so a check outside a
  // callback still covers the callback.
  const isGuarded = (node, key) => {
    for (let child = node; child.parent; child = child.parent) {
      if (parentGuards(child.parent, child, key)) return true;
    }
    return false;
  };

  const locate = (node) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    return `${fileName.replaceAll("\\", "/")}:${line + 1}:${character + 1}`;
  };

  // `start` is where the use is reported, `target` the node reading
  // `missing`.
  const addUsage = (start, target, missing) => {
    usages.push({
      missing,
      guarded: toleratesMissing(target) || isGuarded(target, missing),
      location: locate(start),
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

    // A local from `{ newApi: { newFn } = {} }` reads newApi.newFn, but is
    // already undefined when newApi is missing.
    const index = Math.max(0, missing.split(".").length - startDepth);
    addUsage(start, chain[index], missing);
  };

  const bindElement = (element, member) => {
    if (ts.isIdentifier(element.name)) {
      // With a default, a missing member just falls back to it.
      if (!element.initializer) {
        names.add(element.name.text);
        locals.set(element.name, member);
      }
      return;
    }
    if (!ts.isObjectBindingPattern(element.name)) return;

    // Destructuring a missing object throws, unless it has a default.
    const missing = findMissing(members, member);
    if (missing && !element.initializer) addUsage(element, element, missing);
    else bind(element.name, member);
  };

  // const { getVersion } = window.electron; -> getVersion reads "getVersion".
  const bind = (pattern, prefix) => {
    for (const element of pattern.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (!element.dotDotDotToken && name !== undefined) {
        bindElement(element, prefix ? `${prefix}.${name}` : name);
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
      names.add(node.name.text);
      aliases.add(node.name);
    }
  });

  forEachNode(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isObjectBindingPattern(node.name)
    ) {
      return;
    }

    const { source, hasDefault } = destructuringSource(node.initializer);
    const prefix = isBridge(source) ? "" : memberOf(source);
    if (prefix === null) return;

    // Destructuring a missing object throws, which is reported where it's
    // read.
    if (prefix && !hasDefault && findMissing(members, prefix)) return;
    bind(node.name, prefix);
  });

  forEachNode(sourceFile, (node) => {
    // window.electron.leveldb.get(...)
    const name = accessName(node);
    if (name !== null && isBridge(node.expression)) {
      checkChain(node, name);
      return;
    }

    // getVersion() after `const { getVersion } = window.electron`. Only calls
    // and accesses can throw; a missing local just reads as undefined.
    const member = locals.get(bindingOf(node));
    if (member !== undefined && isCalledOrAccessed(node)) {
      checkChain(node, member);
    }
  });

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
