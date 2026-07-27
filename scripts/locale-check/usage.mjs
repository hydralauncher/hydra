import ts from "typescript";

import {
  REFERENCE_LOCALE,
  TREES,
  VARIANT_SUFFIX,
  byFirstEntry,
  byText,
  flattenText,
  localeFile,
  parseLocale,
  variantBasesOf,
} from "./shared.mjs";

const BIG_PICTURE_NAMESPACE = "big_picture";
const BIG_PICTURE_PREFIX = "format";
const PROPERTY_ACCESSED_KEYS = new Set(["language_name"]);
const TRANSLATE_OBJECTS = new Set(["i18next", "i18n"]);

function parseSource(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function isUseTranslation(node) {
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useTranslation"
  );
}

function isTranslateCall(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text === "t";

  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "t" &&
    ts.isIdentifier(node.expression.expression) &&
    TRANSLATE_OBJECTS.has(node.expression.expression.text)
  );
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function bindsTranslateParameter(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue;

    const bound = current.parameters.some(
      (parameter) =>
        ts.isIdentifier(parameter.name) && parameter.name.text === "t"
    );

    if (bound) return true;
  }

  return false;
}

function stringLiteralsOf(expression) {
  if (expression === undefined) return [];

  if (ts.isStringLiteral(expression)) return [expression.text];

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements
      .filter((element) => ts.isStringLiteral(element))
      .map((element) => element.text);
  }

  return [];
}

function optionOf(node, name) {
  const options = node.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return null;
  }

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (property.name.getText() !== name) continue;

    return property;
  }

  return null;
}

function keyShapeOf(expression) {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return { text: expression.text, prefix: null };
  }

  if (ts.isTemplateExpression(expression)) {
    return { text: null, prefix: expression.head.text || null };
  }

  return { text: null, prefix: null };
}

function collectFileUsage(sourceFile) {
  const namespaces = new Set();
  const calls = [];
  let bareUseTranslation = false;

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;

    if (isUseTranslation(node)) {
      if (node.arguments.length === 0) bareUseTranslation = true;

      for (const namespace of stringLiteralsOf(node.arguments[0])) {
        namespaces.add(namespace);
      }

      return;
    }

    if (!isTranslateCall(node)) return;
    if (bindsTranslateParameter(node)) return;

    const [first] = node.arguments;
    if (first === undefined) return;

    const namespaceOption = optionOf(node, "ns");

    calls.push({
      shape: keyShapeOf(first),
      namespaces: namespaceOption
        ? stringLiteralsOf(namespaceOption.initializer)
        : [],
      defaulted: optionOf(node, "defaultValue") !== null,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  });

  return { namespaces, bareUseTranslation, calls };
}

export function buildNamespaceTable(source) {
  const table = new Map();

  for (const tree of TREES) {
    const flat = flattenText(source.read(localeFile(tree, REFERENCE_LOCALE)));
    if (flat === null) continue;

    const bases = variantBasesOf(flat.keys());

    const parsed = parseLocale(source.read(localeFile(tree, REFERENCE_LOCALE)));
    if (parsed.error !== null) continue;

    if (tree.name === "big-picture") {
      table.set(BIG_PICTURE_NAMESPACE, {
        prefix: BIG_PICTURE_PREFIX,
        flat,
        bases,
        tree,
        exact: new Set(Object.keys(parsed.json.exact ?? {})),
      });
      continue;
    }

    for (const [name, value] of Object.entries(parsed.json)) {
      if (typeof value !== "object" || value === null) continue;

      table.set(name, { prefix: name, flat, bases, tree });
    }
  }

  return table;
}

function resolvesIn(entry, key) {
  const flatKey = `${entry.prefix}.${key}`;

  if (entry.flat.has(flatKey) || entry.bases.has(flatKey)) return true;

  return entry.exact?.has(key) ?? false;
}

function candidateNamespaces(call, usage) {
  if (call.namespaces.length > 0) return call.namespaces;

  if (call.shape.text?.includes(":")) {
    return [call.shape.text.slice(0, call.shape.text.indexOf(":"))];
  }

  return [...usage.namespaces];
}

function keyWithoutNamespace(key) {
  const separator = key.indexOf(":");

  return separator === -1 ? key : key.slice(separator + 1);
}

function unknownNamespace(namespaces, table) {
  return namespaces.find((namespace) => !table.has(namespace)) ?? null;
}

function checkDynamicCall(call, namespaces, table, report) {
  for (const namespace of namespaces) {
    if (call.shape.prefix === null) {
      report({ dynamic: namespace });
      continue;
    }

    report({ wildcard: `${table.get(namespace).prefix}.${call.shape.prefix}` });
  }
}

function checkStaticCall(call, usage, namespaces, table, report) {
  const key = keyWithoutNamespace(call.shape.text);

  if (namespaces.length === 0) {
    if (!usage.bareUseTranslation) return;

    report({
      kind: "usage-no-namespace",
      key,
      line: call.line,
      message: `t("${key}") has no namespace, useTranslation() was called without one and no defaultNS is configured, so it can never resolve`,
    });

    return;
  }

  const matched = namespaces.filter((namespace) =>
    resolvesIn(table.get(namespace), key)
  );

  if (matched.length > 0) {
    for (const namespace of matched) {
      report({ used: `${table.get(namespace).prefix}.${key}` });
    }

    return;
  }

  const tried = namespaces
    .map((namespace) => `${table.get(namespace).prefix}.${key}`)
    .join(", ");
  const hint = call.defaulted ? ", a defaultValue hides this at runtime" : "";

  report({
    kind: "usage-key",
    key,
    line: call.line,
    message: `t("${call.shape.text}") resolves to nothing, tried ${tried}${hint}`,
  });
}

function checkCall(call, usage, table, report) {
  const namespaces = candidateNamespaces(call, usage);
  const unknown = unknownNamespace(namespaces, table);

  if (unknown !== null) {
    report({
      kind: "usage-namespace",
      key: unknown,
      line: call.line,
      message: `namespace "${unknown}" does not exist in any locale resource, every lookup in it misses`,
    });

    return;
  }

  if (call.shape.text === null) {
    checkDynamicCall(call, namespaces, table, report);
    return;
  }

  checkStaticCall(call, usage, namespaces, table, report);
}

function createReporter(state, file, collect) {
  return (result) => {
    if (result.used !== undefined) {
      state.used.add(result.used);
      return;
    }

    if (result.wildcard !== undefined) {
      state.wildcards.add(result.wildcard);
      return;
    }

    if (result.dynamic !== undefined) {
      state.dynamic.add(result.dynamic);
      return;
    }

    const identity = `${file}|${result.kind}|${result.key}`;
    if (state.seen.has(identity)) return;
    state.seen.add(identity);

    collect.push({
      tree: { name: "source" },
      scope: "usage",
      file,
      ...result,
    });
  };
}

function checkFile(source, file, table, state, collect) {
  const text = source.read(file);
  if (text === null || !text.includes("useTranslation")) return;

  const usage = collectFileUsage(parseSource(file, text));
  const report = createReporter(state, file, collect);

  for (const call of usage.calls) {
    checkCall(call, usage, table, report);
  }
}

export function checkUsage(source, table, collect) {
  const state = {
    used: new Set(),
    wildcards: new Set(),
    dynamic: new Set(),
    seen: new Set(),
  };
  const roots = [...new Set(TREES.flatMap((tree) => tree.sourceRoots))].sort(
    byText
  );

  for (const root of roots) {
    for (const file of source.listSources(root)) {
      checkFile(source, file, table, state, collect);
    }
  }

  return {
    used: state.used,
    wildcards: state.wildcards,
    dynamic: state.dynamic,
  };
}

function isCoveredByUsage(key, usage) {
  if (usage.used.has(key)) return true;

  if (
    VARIANT_SUFFIX.test(key) &&
    usage.used.has(key.replace(VARIANT_SUFFIX, ""))
  ) {
    return true;
  }

  return [...usage.wildcards].some((wildcard) => key.startsWith(wildcard));
}

export function reportUnusedKeys(table, usage, collect) {
  const owners = new Map();

  for (const entry of table.values()) {
    for (const key of entry.flat.keys()) {
      if (!key.startsWith(`${entry.prefix}.`)) continue;
      owners.set(key, entry);
    }
  }

  for (const [key, entry] of [...owners].sort(byFirstEntry)) {
    if (PROPERTY_ACCESSED_KEYS.has(key.slice(key.lastIndexOf(".") + 1))) {
      continue;
    }

    if (isCoveredByUsage(key, usage)) continue;

    collect.push({
      tree: entry.tree,
      scope: "unused",
      kind: "unused",
      key,
      file: localeFile(entry.tree, REFERENCE_LOCALE),
      line: 1,
      advisory: true,
      message: `"${key}" is never read by a resolvable t() call`,
    });
  }
}
