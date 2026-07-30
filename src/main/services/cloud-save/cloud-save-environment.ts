import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CloudSavePathContext } from "@types";

export const CLOUD_SAVE_ENVIRONMENT_MARKER = ".hydra-cloud-save-environment-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PrefixIdentityMode =
  | "marker"
  | "local-fallback"
  | "filesystem"
  | "session";

export interface PrefixGenerationStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface PrefixGenerationDependencies {
  store?: PrefixGenerationStore;
  writeMarker?: (markerPath: string, marker: string) => Promise<boolean>;
}

export interface CloudSavePrefixGenerationOverride {
  generationId: string;
  prefixIdentityMode: PrefixIdentityMode;
}

export interface RotatedCloudSavePrefixGeneration
  extends CloudSavePrefixGenerationOverride {
  durable: boolean;
}

interface PrefixGenerationRecord {
  generationId: string;
  fingerprint: string | null;
}

const prefixGenerationQueues = new Map<string, Promise<void>>();
const volatilePrefixGenerations = new Map<string, PrefixGenerationRecord>();

const canonicalizePath = async (value?: string) => {
  if (!value) return null;

  return fs.promises.realpath(value).catch(() => path.resolve(value));
};

const readPrefixMarker = async (markerPath: string) => {
  const value = await fs.promises
    .readFile(markerPath, "utf8")
    .catch(() => null);
  const marker = value?.trim() ?? "";
  return UUID_PATTERN.test(marker) ? marker.toLowerCase() : null;
};

const writePrefixMarker = async (markerPath: string, marker: string) => {
  const temporaryPath = `${markerPath}.${marker}.tmp`;

  try {
    const handle = await fs.promises.open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${marker}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporaryPath, markerPath);
    return true;
  } catch {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    return false;
  }
};

const getPrefixGenerationKey = (prefixPath: string) =>
  createHash("sha256").update(prefixPath).digest("hex");

const getFileIdentity = async (value: string) => {
  try {
    const stat = await fs.promises.stat(value);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  } catch {
    return null;
  }
};

const getPrefixFingerprint = async (prefixPath: string) => {
  const [prefixIdentity, driveIdentity] = await Promise.all([
    getFileIdentity(prefixPath),
    getFileIdentity(path.join(prefixPath, "drive_c")),
  ]);
  if (!prefixIdentity) return null;
  return `prefix:${prefixIdentity}|drive_c:${driveIdentity ?? "missing"}`;
};

const serializePrefixGeneration = (record: PrefixGenerationRecord) =>
  JSON.stringify(record);

const parsePrefixGeneration = (value?: string) => {
  if (!value) return null;
  if (UUID_PATTERN.test(value)) {
    return {
      kind: "legacy" as const,
      generationId: value.toLowerCase(),
    };
  }

  try {
    const record = JSON.parse(value) as Partial<PrefixGenerationRecord>;
    if (
      typeof record.generationId === "string" &&
      UUID_PATTERN.test(record.generationId) &&
      typeof record.fingerprint === "string" &&
      record.fingerprint.length > 0
    ) {
      return {
        kind: "fingerprinted" as const,
        generationId: record.generationId.toLowerCase(),
        fingerprint: record.fingerprint,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const defaultPrefixGenerationStore: PrefixGenerationStore = {
  get: async (key) => {
    const { cloudSavePrefixGenerationsSublevel } = await import("@main/level");
    return cloudSavePrefixGenerationsSublevel.get(key);
  },
  put: async (key, value) => {
    const { cloudSavePrefixGenerationsSublevel } = await import("@main/level");
    return cloudSavePrefixGenerationsSublevel.put(key, value);
  },
  del: async (key) => {
    const { cloudSavePrefixGenerationsSublevel } = await import("@main/level");
    return cloudSavePrefixGenerationsSublevel.del(key);
  },
};

const runPrefixGenerationOperation = async <T>(
  key: string,
  operation: () => Promise<T>
) => {
  const previous = prefixGenerationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  prefixGenerationQueues.set(key, tail);

  try {
    return await current;
  } finally {
    if (prefixGenerationQueues.get(key) === tail) {
      prefixGenerationQueues.delete(key);
    }
  }
};

const persistMarker = async (
  prefixPath: string,
  marker: string,
  dependencies: PrefixGenerationDependencies = {},
  fingerprint?: string | null
) => {
  const key = getPrefixGenerationKey(prefixPath);
  const store = dependencies.store ?? defaultPrefixGenerationStore;
  const markerWriter = dependencies.writeMarker ?? writePrefixMarker;
  const currentFingerprint =
    fingerprint === undefined
      ? await getPrefixFingerprint(prefixPath)
      : fingerprint;
  let storedLocally = false;

  if (currentFingerprint) {
    try {
      await store.put(
        key,
        serializePrefixGeneration({
          generationId: marker,
          fingerprint: currentFingerprint,
        })
      );
      storedLocally = true;
    } catch {
      storedLocally = false;
    }
  }

  const markerWritten = await markerWriter(
    path.join(prefixPath, CLOUD_SAVE_ENVIRONMENT_MARKER),
    marker
  );
  if (markerWritten) {
    await store.del(key).catch(() => undefined);
  }
  if (markerWritten || storedLocally) {
    volatilePrefixGenerations.delete(key);
  } else {
    volatilePrefixGenerations.set(key, {
      generationId: marker,
      fingerprint: currentFingerprint,
    });
  }

  return { markerWritten, storedLocally };
};

const ensurePrefixGeneration = async (
  prefixPath: string,
  dependencies: PrefixGenerationDependencies = {}
) => {
  const key = getPrefixGenerationKey(prefixPath);
  const store = dependencies.store ?? defaultPrefixGenerationStore;
  const markerWriter = dependencies.writeMarker ?? writePrefixMarker;

  return runPrefixGenerationOperation(key, async () => {
    const fingerprint = await getPrefixFingerprint(prefixPath);
    const pending = parsePrefixGeneration(
      await store.get(key).catch(() => undefined)
    );
    let existingMarker: string | null | undefined;
    let ignoreExistingMarker = false;

    if (pending?.kind === "fingerprinted") {
      if (fingerprint && pending.fingerprint === fingerprint) {
        const markerWritten = await markerWriter(
          path.join(prefixPath, CLOUD_SAVE_ENVIRONMENT_MARKER),
          pending.generationId
        );
        if (markerWritten) await store.del(key).catch(() => undefined);
        return {
          generationId: pending.generationId,
          prefixIdentityMode: markerWritten
            ? ("marker" as const)
            : ("local-fallback" as const),
        };
      }
      ignoreExistingMarker = true;
    } else if (pending?.kind === "legacy") {
      existingMarker = await readPrefixMarker(
        path.join(prefixPath, CLOUD_SAVE_ENVIRONMENT_MARKER)
      );
      if (existingMarker === pending.generationId) {
        await store.del(key).catch(() => undefined);
        return {
          generationId: existingMarker,
          prefixIdentityMode: "marker" as const,
        };
      }
      ignoreExistingMarker = true;
    }

    const volatileGeneration = volatilePrefixGenerations.get(key);
    if (volatileGeneration && volatileGeneration.fingerprint === fingerprint) {
      const persisted = await persistMarker(
        prefixPath,
        volatileGeneration.generationId,
        dependencies,
        fingerprint
      );
      return {
        generationId: volatileGeneration.generationId,
        prefixIdentityMode: persisted.markerWritten
          ? ("marker" as const)
          : persisted.storedLocally
            ? ("local-fallback" as const)
            : ("session" as const),
      };
    } else if (volatileGeneration) {
      volatilePrefixGenerations.delete(key);
      ignoreExistingMarker = true;
    }

    existingMarker ??= await readPrefixMarker(
      path.join(prefixPath, CLOUD_SAVE_ENVIRONMENT_MARKER)
    );
    if (existingMarker && !ignoreExistingMarker) {
      return {
        generationId: existingMarker,
        prefixIdentityMode: "marker" as const,
      };
    }

    const generationId = randomUUID();
    const persisted = await persistMarker(
      prefixPath,
      generationId,
      dependencies,
      fingerprint
    );
    if (persisted.markerWritten || persisted.storedLocally) {
      return {
        generationId,
        prefixIdentityMode: persisted.markerWritten
          ? ("marker" as const)
          : ("local-fallback" as const),
      };
    }

    return {
      generationId,
      prefixIdentityMode: "session" as const,
    };
  });
};

export const rotateCloudSavePrefixGeneration = async (
  prefixPath: string,
  dependencies: PrefixGenerationDependencies = {}
): Promise<RotatedCloudSavePrefixGeneration> => {
  const canonicalPrefixPath =
    (await canonicalizePath(prefixPath)) ?? path.resolve(prefixPath);
  const key = getPrefixGenerationKey(canonicalPrefixPath);

  return runPrefixGenerationOperation(key, async () => {
    const generationId = randomUUID();
    const persisted = await persistMarker(
      canonicalPrefixPath,
      generationId,
      dependencies
    );
    const durable = persisted.markerWritten || persisted.storedLocally;
    return {
      generationId,
      prefixIdentityMode: persisted.markerWritten
        ? "marker"
        : persisted.storedLocally
          ? "local-fallback"
          : "session",
      durable,
    };
  });
};

const getFilesystemPrefixGeneration = async (prefixPath: string) => {
  try {
    const stat = await fs.promises.stat(prefixPath);
    return `fs:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  } catch {
    return "missing";
  }
};

const getPrefixGeneration = async (
  prefixPath: string,
  prefixIsValid: boolean,
  override?: CloudSavePrefixGenerationOverride,
  dependencies?: PrefixGenerationDependencies
) => {
  if (override) {
    return {
      value: `marker:${override.generationId}`,
      mode: override.prefixIdentityMode,
    };
  }

  if (prefixIsValid) {
    const generation = await ensurePrefixGeneration(prefixPath, dependencies);
    if (generation) {
      return {
        value: `marker:${generation.generationId}`,
        mode: generation.prefixIdentityMode,
      };
    }
  }

  return {
    value: await getFilesystemPrefixGeneration(prefixPath),
    mode: "filesystem" as const,
  };
};

export interface ResolveCloudSaveEnvironmentOptions {
  winePrefixIsValid?: boolean;
  prefixGenerationOverride?: CloudSavePrefixGenerationOverride;
  prefixGenerationDependencies?: PrefixGenerationDependencies;
}

export const resolveCloudSaveEnvironment = async (
  input: CloudSavePathContext,
  options: ResolveCloudSaveEnvironmentOptions = {}
) => {
  const executablePath = await canonicalizePath(input.executablePath);
  const executableDirectory = executablePath
    ? path.dirname(executablePath)
    : null;
  const winePrefixPath = await canonicalizePath(input.winePrefixPath);
  const canonicalContext: CloudSavePathContext = {
    ...input,
    homeDir: (await canonicalizePath(input.homeDir)) ?? input.homeDir,
    documentsDir:
      (await canonicalizePath(input.documentsDir)) ?? input.documentsDir,
    appDataDir: (await canonicalizePath(input.appDataDir)) ?? input.appDataDir,
    executablePath: executablePath ?? undefined,
    winePrefixPath: winePrefixPath ?? undefined,
    steamPath: (await canonicalizePath(input.steamPath)) ?? input.steamPath,
  };
  const prefixGeneration = winePrefixPath
    ? await getPrefixGeneration(
        winePrefixPath,
        options.winePrefixIsValid === true,
        options.prefixGenerationOverride,
        options.prefixGenerationDependencies
      )
    : null;
  const identity = JSON.stringify({
    version: 1,
    platform: canonicalContext.platform,
    homeDir: canonicalContext.homeDir,
    documentsDir: canonicalContext.documentsDir ?? null,
    appDataDir: canonicalContext.appDataDir ?? null,
    executableDirectory,
    winePrefixPath,
    prefixGeneration: prefixGeneration?.value ?? null,
    steamPath: canonicalContext.steamPath ?? null,
  });

  return {
    environmentId: createHash("sha256").update(identity).digest("hex"),
    pathContext: canonicalContext,
    prefixIdentityMode: prefixGeneration?.mode ?? ("filesystem" as const),
  };
};
