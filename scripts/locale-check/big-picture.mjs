import ts from "typescript";

import { REFERENCE_LOCALE, TREES, localeFile, parseLocale } from "./shared.mjs";

const TRANSLATED_ATTRIBUTES = new Set([
  "aria-label",
  "alt",
  "placeholder",
  "title",
]);

const MEANINGFUL = /\p{L}{2}/u;
const IGNORED_SOURCES = ["/component-lab/"];

function isMeaningful(text) {
  return MEANINGFUL.test(text) && !text.includes("{{");
}

function collapseJsxWhitespace(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function collectLiterals(sourceFile) {
  const literals = [];

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = collapseJsxWhitespace(node.text);

      if (isMeaningful(text)) {
        literals.push({
          text,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          origin: "text",
        });
      }
    }

    if (
      ts.isJsxAttribute(node) &&
      TRANSLATED_ATTRIBUTES.has(node.name.getText())
    ) {
      const value = node.initializer;

      if (value !== undefined && ts.isStringLiteral(value)) {
        const text = value.text.trim();

        if (isMeaningful(text)) {
          literals.push({
            text,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            origin: node.name.getText(),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return literals;
}

export function checkBigPictureLiterals(source, collect) {
  const tree = TREES.find((candidate) => candidate.name === "big-picture");
  if (tree === undefined) return;

  const referenceFile = localeFile(tree, REFERENCE_LOCALE);
  const parsed = parseLocale(source.read(referenceFile) ?? "");
  if (parsed.error !== null) return;

  const exact = new Set(Object.keys(parsed.json.exact ?? {}));
  const seen = new Set();

  for (const root of tree.sourceRoots) {
    for (const file of source.listSources(root)) {
      if (!file.endsWith(".tsx")) continue;
      if (IGNORED_SOURCES.some((ignored) => file.includes(ignored))) continue;

      const text = source.read(file);
      if (text === null) continue;

      const sourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );

      for (const literal of collectLiterals(sourceFile)) {
        if (exact.has(literal.text)) continue;
        if (seen.has(literal.text)) continue;
        seen.add(literal.text);

        collect.push({
          tree,
          scope: "literals",
          kind: "bp-literal",
          key: literal.text,
          file,
          line: literal.line,
          message: `Big Picture renders "${literal.text}" but it is not a key in the ${REFERENCE_LOCALE} exact map, so it stays English in every language`,
        });
      }
    }
  }
}
