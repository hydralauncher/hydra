import {
  REFERENCE_LOCALE,
  TRANSLATION_FILE,
  VARIANT_SUFFIX,
  flatten,
  localeFile,
  nestingRefsOf,
  parseLocale,
  placeholdersOf,
  scanKeys,
  typeNameOf,
  variantBasesOf,
} from "./shared.mjs";

function checkDuplicates(context, duplicates) {
  for (const duplicate of duplicates) {
    context.push({
      kind: "duplicate",
      key: duplicate.key,
      line: duplicate.line,
      message: `duplicate key "${duplicate.key}", the last occurrence silently wins and the other translation is dropped`,
    });
  }
}

function checkNesting(context) {
  const { reference, flat, lines } = context;

  for (const [key, value] of flat) {
    for (const reference_ of nestingRefsOf(value)) {
      if (reference.has(reference_) || flat.has(reference_)) continue;

      context.push({
        kind: "nesting",
        key: `${key}->${reference_}`,
        line: lines.get(key) ?? 1,
        message: `"${key}" nests $t(${reference_}) but that key does not exist`,
      });
    }
  }
}

function checkAgainstReference(context) {
  const { reference, flat, lines } = context;

  for (const [key, value] of reference) {
    if (!flat.has(key)) {
      context.push({
        kind: "missing",
        key,
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
        line: lines.get(key) ?? 1,
        message: `"${key}" placeholders differ, ${REFERENCE_LOCALE} has [${expected}] and ${context.scope} has [${actual}]`,
      });
    }
  }
}

function checkExtraKeys(context) {
  const { reference, referenceVariantBases, flat, lines } = context;

  for (const key of flat.keys()) {
    if (reference.has(key)) continue;

    const isKnownVariant =
      VARIANT_SUFFIX.test(key) &&
      referenceVariantBases.has(key.replace(VARIANT_SUFFIX, ""));

    if (isKnownVariant) continue;

    context.push({
      kind: "extra",
      key,
      line: lines.get(key) ?? 1,
      message: `"${key}" does not exist in the ${REFERENCE_LOCALE} locale, it is dead weight or a leftover rename`,
    });
  }
}

function checkLocale(source, tree, locale, shared, collect) {
  const file = localeFile(tree, locale);
  const text = source.read(file);
  if (text === null) return;

  collect.scopes.add(`${tree.name}|${locale}`);

  const push = (finding) =>
    collect.push({ file, ...finding, tree, scope: locale });

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
      line: 1,
      message: `cannot parse: ${parsed.error}`,
    });
    return;
  }

  const { lines, duplicates } = scanKeys(text);
  const context = { ...shared, scope: locale, lines, push };

  checkDuplicates(context, duplicates);

  context.flat = flatten(parsed.json, "", new Map());
  checkNesting(context);

  if (locale === REFERENCE_LOCALE) return;

  checkAgainstReference(context);
  checkExtraKeys(context);
}

export function checkTreeParity(source, tree, collect) {
  const locales = source.listLocales(tree.dir);
  if (locales === null) return null;

  const referenceFile = localeFile(tree, REFERENCE_LOCALE);
  const referenceText = source.read(referenceFile);
  if (referenceText === null) return null;

  const parsedReference = parseLocale(referenceText);
  if (parsedReference.error !== null) {
    collect.push({
      tree,
      scope: REFERENCE_LOCALE,
      kind: "parse-error",
      key: "",
      file: referenceFile,
      line: 1,
      message: `cannot parse reference locale: ${parsedReference.error}`,
    });
    return null;
  }

  const reference = flatten(parsedReference.json, "", new Map());
  const shared = {
    registry: source.read(tree.registry) ?? "",
    reference,
    referenceVariantBases: variantBasesOf(reference.keys()),
  };

  for (const locale of locales) {
    checkLocale(source, tree, locale, shared, collect);
  }

  return { locales, reference };
}
