import ts from "typescript";

import { REFERENCE_LOCALE, TREES, byText, localeFile } from "./shared.mjs";

const FLAG_MAP_FILE = "src/shared/language-flags.ts";
const FLAG_MAP_NAME = "LANGUAGE_FLAG_MAP";

const PREFIX_CHAINS = [
  {
    file: "src/shared/index.ts",
    symbol: "getDateLocale",
    trees: ["desktop"],
    what: "date-fns locale",
    consequence: "dates render with the en-US locale",
  },
  {
    file: "src/big-picture/src/hooks/use-date.hook.ts",
    symbol: "getDateLocale",
    trees: ["big-picture"],
    what: "Big Picture date-fns locale",
    consequence: "Big Picture dates render with the en-US locale",
  },
  {
    file: "src/big-picture/src/i18n.tsx",
    symbol: "resolveBigPictureLanguage",
    trees: ["big-picture"],
    what: "Big Picture language resolver",
    consequence: "Big Picture falls back to English strings",
  },
];

function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function findDeclaration(sourceFile, name) {
  let found = null;

  const visit = (node) => {
    if (found !== null) return;

    const matches =
      (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name);

    if (matches) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function collectStartsWithArguments(node) {
  const prefixes = new Set();

  const visit = (current) => {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "startsWith"
    ) {
      const [argument] = current.arguments;

      if (argument !== undefined && ts.isStringLiteral(argument)) {
        prefixes.add(argument.text);
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);

  return prefixes;
}

function collectObjectKeys(node) {
  const keys = new Set();

  const visit = (current) => {
    if (ts.isObjectLiteralExpression(current)) {
      for (const property of current.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        if (
          ts.isStringLiteral(property.name) ||
          ts.isIdentifier(property.name)
        ) {
          keys.add(property.name.text);
        }
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);

  return keys;
}

function localesByTree(source) {
  const map = new Map();

  for (const tree of TREES) {
    map.set(tree.name, { tree, locales: source.listLocales(tree.dir) ?? [] });
  }

  return map;
}

function checkFlagMap(source, trees, collect) {
  const text = source.read(FLAG_MAP_FILE);
  if (text === null) return;

  const declaration = findDeclaration(
    parse(FLAG_MAP_FILE, text),
    FLAG_MAP_NAME
  );
  if (declaration === null) return;

  const mapped = collectObjectKeys(declaration);
  const desktop = trees.get("desktop");
  if (desktop === undefined) return;

  for (const locale of desktop.locales) {
    if (mapped.has(locale)) continue;

    collect.push({
      tree: desktop.tree,
      scope: locale,
      kind: "wiring",
      key: FLAG_MAP_NAME,
      file: FLAG_MAP_FILE,
      line: 1,
      message: `locale "${locale}" is missing from ${FLAG_MAP_NAME}, so it renders without a flag`,
    });
  }
}

function checkPrefixChain(source, chain, trees, collect) {
  const text = source.read(chain.file);
  if (text === null) return;

  const declaration = findDeclaration(parse(chain.file, text), chain.symbol);
  if (declaration === null) return;

  const prefixes = [...collectStartsWithArguments(declaration)];
  if (prefixes.length === 0) return;

  for (const treeName of chain.trees) {
    const entry = trees.get(treeName);
    if (entry === undefined) continue;

    for (const locale of entry.locales) {
      if (locale === "en") continue;
      if (prefixes.some((prefix) => locale.startsWith(prefix))) continue;

      collect.push({
        tree: entry.tree,
        scope: locale,
        kind: "wiring",
        key: chain.symbol,
        file: chain.file,
        line: 1,
        message: `locale "${locale}" is not matched by any prefix in ${chain.symbol} (${chain.what}), so ${chain.consequence}`,
      });
    }
  }
}

export function checkWiring(source, collect) {
  const trees = localesByTree(source);

  checkFlagMap(source, trees, collect);

  for (const chain of PREFIX_CHAINS) {
    checkPrefixChain(source, chain, trees, collect);
  }
}

export function reportRenames(tree, removedKeys, localeFlats, collect) {
  for (const key of [...removedKeys].sort(byText)) {
    const stillCarrying = [...localeFlats]
      .filter(([locale, flat]) => locale !== "en" && flat.has(key))
      .map(([locale]) => locale);

    if (stillCarrying.length === 0) continue;

    const listed = stillCarrying.slice(0, 6).join(", ");
    const rest = stillCarrying.length > 6 ? ", and more" : "";

    collect.push({
      tree,
      scope: "renames",
      kind: "rename",
      key,
      file: localeFile(tree, REFERENCE_LOCALE),
      line: 1,
      advisory: true,
      message: `"${key}" was removed from ${REFERENCE_LOCALE} but ${stillCarrying.length} locales still carry it (${listed}${rest}), those translations are now unreachable`,
    });
  }
}
