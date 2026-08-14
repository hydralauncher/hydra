import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MacCompatibilityGameKey } from "../MacCompatibilityTypes";

/**
 * Single source of truth for where Hydra keeps its per-game Wine
 * environments, how each environment folder is named, and which paths
 * are allowed to be deleted.
 *
 * Every destructive operation (delete / repair) must run its target
 * through assertManagedPrefixPath() immediately before calling rm(),
 * because prefixPath values are persisted in environments.json and a
 * corrupted or hand-edited registry must never be able to point rm()
 * at something outside the environments folder.
 */

export const DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Hydra",
  "mac-compatibility",
  "environments.json"
);

export const DEFAULT_MAC_ENVIRONMENTS_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Hydra",
  "mac-compatibility",
  "environments"
);

/** Length of the identity hash appended to every environment folder. */
const IDENTITY_HASH_LENGTH = 16;

/** Longest readable label kept from an object id. */
const MAX_LABEL_LENGTH = 48;

/**
 * Makes a value safe to use inside a folder name. This is lossy on
 * purpose (it is only the readable part of the name), which is exactly
 * why createEnvironmentId() also appends a hash of the untouched
 * identity.
 */
export function sanitizeEnvironmentIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Deterministic, collision-free folder name for one game.
 *
 * The readable label can collide ("foo/bar" and "foo:bar" both
 * sanitize to "foo-bar"), so the untouched shop and object id are
 * hashed together and the hash is part of the name. Same game in,
 * same folder out — across restarts and across machines.
 */
export function createEnvironmentId(game: MacCompatibilityGameKey): string {
  const shopLabel = sanitizeEnvironmentIdPart(game.shop) || "shop";

  const objectLabel =
    sanitizeEnvironmentIdPart(game.objectId)
      .slice(0, MAX_LABEL_LENGTH)
      .replace(/-+$/, "") || "game";

  const identityHash = createHash("sha256")
    .update(`${game.shop}\u0000${game.objectId}`)
    .digest("hex")
    .slice(0, IDENTITY_HASH_LENGTH);

  return `${shopLabel}-${objectLabel}-${identityHash}`;
}

/**
 * The one and only folder this game is allowed to own, derived from
 * the game identity instead of read from disk.
 */
export function resolveManagedPrefixPath(
  environmentsPath: string,
  game: MacCompatibilityGameKey
): string {
  return join(resolve(environmentsPath), createEnvironmentId(game));
}

function isContainedIn(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);

  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

async function realpathIfExists(targetPath: string): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch {
    return null;
  }
}

/**
 * Throws unless prefixPath is a direct child of the environments root.
 * Returns the resolved, safe-to-delete absolute path.
 *
 * Rejects: empty values, the environments root itself, anything
 * outside the root, ".." traversal, nested or deeper paths, and
 * symlinks whose real location escapes the root.
 */
export async function assertManagedPrefixPath(
  environmentsPath: string,
  prefixPath: string | null | undefined
): Promise<string> {
  if (typeof prefixPath !== "string" || prefixPath.trim() === "") {
    throw new Error(
      "Refusing to modify a Wine environment: no prefix path was provided."
    );
  }

  const resolvedRoot = resolve(environmentsPath);
  const resolvedTarget = resolve(prefixPath);

  if (resolvedTarget === resolvedRoot) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is the environments folder itself.`
    );
  }

  if (!isContainedIn(resolvedRoot, resolvedTarget)) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is outside "${resolvedRoot}".`
    );
  }

  const segments = relative(resolvedRoot, resolvedTarget).split(sep);

  if (segments.length !== 1) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is not a direct child of "${resolvedRoot}".`
    );
  }

  const realRoot = (await realpathIfExists(resolvedRoot)) ?? resolvedRoot;
  const realTarget = await realpathIfExists(resolvedTarget);

  if (realTarget !== null) {
    if (realTarget === realRoot || !isContainedIn(realRoot, realTarget)) {
      throw new Error(
        `Refusing to modify a Wine environment: "${resolvedTarget}" really points at "${realTarget}", which is outside "${realRoot}".`
      );
    }
  }

  return resolvedTarget;
}

/**
 * Throws unless targetPath sits inside an already-validated prefix
 * folder. Returns the resolved, safe-to-delete absolute path.
 */
export function assertPathInsidePrefix(
  prefixPath: string,
  targetPath: string
): string {
  const resolvedPrefix = resolve(prefixPath);
  const resolvedTarget = resolve(targetPath);

  if (!isContainedIn(resolvedPrefix, resolvedTarget)) {
    throw new Error(
      `Refusing to delete "${resolvedTarget}": it is outside the Wine prefix "${resolvedPrefix}".`
    );
  }

  return resolvedTarget;
}
