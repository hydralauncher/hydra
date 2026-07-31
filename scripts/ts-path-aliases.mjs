import { readFileSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

const { compilerOptions } = JSON.parse(
  readFileSync(resolvePath(projectRoot, "tsconfig.node.json"), "utf8")
);

const aliases = Object.entries(compilerOptions?.paths ?? {}).map(
  ([pattern, targets]) => ({
    prefix: pattern.replace(/\*$/, ""),
    target: targets[0].replace(/\*$/, ""),
    isPrefix: pattern.endsWith("*"),
  })
);

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const findFile = (path) =>
  [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(isFile);

const resolveAlias = (specifier) => {
  for (const { prefix, target, isPrefix } of aliases) {
    const matches = isPrefix
      ? specifier.startsWith(prefix)
      : specifier === prefix;

    if (!matches) continue;

    const suffix = isPrefix ? specifier.slice(prefix.length) : "";

    return findFile(resolvePath(projectRoot, `${target}${suffix}`));
  }

  return undefined;
};

const resolveExtensionless = (specifier, parentURL) => {
  if (!parentURL || !specifier.startsWith(".")) return undefined;

  return findFile(resolvePath(dirname(fileURLToPath(parentURL)), specifier));
};

export const resolve = async (specifier, context, nextResolve) => {
  const mapped = resolveAlias(specifier);

  if (mapped) return nextResolve(pathToFileURL(mapped).href, context);

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const fallback = resolveExtensionless(specifier, context.parentURL);

    if (!fallback) throw error;

    return nextResolve(pathToFileURL(fallback).href, context);
  }
};
