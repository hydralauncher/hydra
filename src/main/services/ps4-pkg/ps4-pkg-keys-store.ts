import fs from "node:fs";
import path from "node:path";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { SystemPath } from "../system-path";
import type { Ps4PkgKeys, Ps4PkgRsaKey } from "./ps4-pkg-crypto";
import { Ps4PkgError } from "./ps4-pkg-info";

const KEYS_FILE = "ps4-pkg-keys.json";
const HEX = /^[0-9a-f]+$/i;

let cached: Ps4PkgKeys | null = null;

const isRsaKey = (value: unknown): value is Ps4PkgRsaKey => {
  const key = value as Partial<Ps4PkgRsaKey> | null;
  return (
    typeof key?.modulus === "string" &&
    HEX.test(key.modulus) &&
    typeof key.privateExponent === "string" &&
    HEX.test(key.privateExponent)
  );
};

const isPs4PkgKeys = (value: unknown): value is Ps4PkgKeys => {
  const keys = value as Partial<Ps4PkgKeys> | null;
  return isRsaKey(keys?.pkgDerivedKey3) && isRsaKey(keys?.fake);
};

const keysFilePath = () => path.join(SystemPath.getPath("userData"), KEYS_FILE);

const readStoredKeys = async () => {
  const contents = await fs.promises
    .readFile(keysFilePath(), "utf8")
    .catch(() => null);
  if (!contents) return null;
  try {
    const keys: unknown = JSON.parse(contents);
    return isPs4PkgKeys(keys) ? keys : null;
  } catch {
    return null;
  }
};

/** Drops the stored keys, so the next extraction fetches them again. */
export const forgetPs4PkgKeys = async () => {
  cached = null;
  await fs.promises.rm(keysFilePath(), { force: true });
};

/**
 * The keys to open PS4 fake PKGs. They are fetched once from the Hydra API
 * (no login needed) and kept on disk, so extracting works offline afterwards.
 */
export const getPs4PkgKeys = async (): Promise<Ps4PkgKeys> => {
  if (cached) return cached;

  const stored = await readStoredKeys();
  if (stored) {
    cached = stored;
    return stored;
  }

  const fetched = await HydraApi.get<unknown>("/emulators/ps4/pkg-keys", null, {
    needsAuth: false,
    // The network log is written to disk and shared in bug reports.
    logResponseBody: false,
  }).catch((error) => {
    logger.error("Could not fetch the PS4 PKG keys", error);
    return null;
  });
  if (!isPs4PkgKeys(fetched)) {
    throw new Ps4PkgError(
      "keys_unavailable",
      "The PS4 PKG keys could not be fetched"
    );
  }

  const keys: Ps4PkgKeys = {
    pkgDerivedKey3: fetched.pkgDerivedKey3,
    fake: fetched.fake,
  };
  await fs.promises
    .writeFile(keysFilePath(), JSON.stringify(keys))
    .catch((error) => logger.error("Could not store the PS4 PKG keys", error));
  cached = keys;
  return keys;
};
