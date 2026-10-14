import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Game } from "../../../types/level.types";
import type {
  EpicGameInstallOption,
  EpicGameInstallOptions,
  EpicInstallPlatform,
  EpicLocalOwner,
} from "../../../types/epic-managed.types";
import type { EpicSyncContext } from "./sync-orchestrator";
import { isRecord } from "./auth-protocol.js";
import { isEpicObjectId } from "./library-normalizer.js";
import { epicManagedInstallationSupport } from "./managed-platform.js";
import { resolveEpicWindowsPath } from "./windows-path.js";
import {
  EPIC_SYNC_MAX_OUTPUT_BYTES,
  EPIC_MAX_ARTIFACTS,
  EPIC_INSTALL_OPTIONS_CACHE_MS,
  EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES,
  EPIC_INSTALL_OPTIONS_TIMEOUT_MS,
  EPIC_INSTALL_LIBRARY_CACHE_MS,
} from "./constants.js";
import {
  EpicManagedError,
  epicManagedErrorCode,
  epicOwnerMatches,
  type EpicManagedTarget,
  type LegendaryManagedRuntime,
} from "./legendary-managed-runtime.js";

export interface EpicOwnedGame extends EpicSyncContext {
  game: Game;
  owner: EpicLocalOwner;
  artifactIds: string[];
}
export interface EpicInstalledGame {
  app_name: string;
  install_path: string;
  executable: string;
  platform: EpicInstallPlatform;
  install_size: number;
  version: string;
  save_path?: string | null;
  can_run_offline?: boolean;
  requires_ot?: boolean;
  prereq_info?: Record<string, unknown> | null;
  installPath: string;
  executablePath: string;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}
interface InstallationOptions {
  runtime: LegendaryManagedRuntime;
  capture: () => Promise<EpicSyncContext>;
  captureLocal?: () => EpicSyncContext | null;
  current: (context: EpicSyncContext) => boolean;
  ownGame: (
    context: EpicSyncContext,
    objectId: string,
    signal: AbortSignal
  ) => Promise<{
    epicImport: { connectionId: string; artifactIds: string[] } | null;
  } | null>;
  getGame: (objectId: string) => Promise<Game | undefined>;
  updateGame: (
    objectId: string,
    patch: (game: Game) => Partial<Game>
  ) => Promise<Game | undefined>;
  platform?: NodeJS.Platform;
  architecture?: string;
}

interface SharedEpicRequest<T> {
  context: EpicSyncContext;
  controller: AbortController;
  expiresAt: number;
  waiters: number;
  settled: boolean;
  value?: T;
  promise: Promise<T>;
}

const abortError = (signal: AbortSignal) =>
  signal.reason instanceof EpicManagedError
    ? signal.reason
    : new EpicManagedError("operation-cancelled");

function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

export const isSafeEpicArtifact = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(value) &&
  value !== "." &&
  value !== "..";
export const epicManagedTarget = (
  owned: EpicOwnedGame,
  artifactId: string,
  platform: EpicInstallPlatform
): EpicManagedTarget => ({
  auth: owned.auth,
  connection: owned.connection,
  owner: owned.owner,
  artifactId,
  platform,
});

export function isPathContained(root: string, file: string, allowRoot = false) {
  const relative = path.relative(root, file);
  return (
    (allowRoot || relative !== "") &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
export async function readManagedJson(file: string): Promise<unknown> {
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > EPIC_SYNC_MAX_OUTPUT_BYTES
  )
    throw new EpicManagedError("invalid-response");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new EpicManagedError("invalid-response");
  }
}
export async function writeManagedJson(file: string, value: unknown) {
  const directory = path.dirname(file);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new EpicManagedError("invalid-path");
  const temporary = path.join(directory, `.hydra-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function validateEpicMetadata(
  value: unknown,
  target: EpicManagedTarget,
  objectId?: string
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    value.app_name !== target.artifactId ||
    !isRecord(value.metadata)
  )
    throw new EpicManagedError("invalid-artifact");
  const metadata = value.metadata;
  if (
    typeof metadata.namespace !== "string" ||
    typeof metadata.id !== "string" ||
    !isEpicObjectId(`${metadata.namespace}:${metadata.id}`) ||
    (objectId && `${metadata.namespace}:${metadata.id}` !== objectId)
  )
    throw new EpicManagedError("invalid-artifact");
  if (
    metadata.namespace === "ue" ||
    metadata.mainGameItem != null ||
    !Array.isArray(metadata.categories) ||
    !metadata.categories.some(
      (category) => isRecord(category) && category.path === "games"
    ) ||
    metadata.categories.some(
      (category) =>
        isRecord(category) &&
        ["addons", "addons/launchable"].includes(String(category.path))
    )
  )
    throw new EpicManagedError("not-installable");
  const attributes = metadata.customAttributes;
  if (
    isRecord(attributes) &&
    [
      "ThirdPartyManagedApp",
      "ThirdPartyManagedProvider",
      "partnerLinkType",
    ].some((name) => {
      const attribute = attributes[name];
      return (
        isRecord(attribute) &&
        typeof attribute.value === "string" &&
        attribute.value.trim().length > 0
      );
    })
  )
    throw new EpicManagedError("external-launcher-required");
  if (!isRecord(value.asset_infos))
    throw new EpicManagedError("invalid-artifact");
  const asset = value.asset_infos[target.platform];
  if (
    !isRecord(asset) ||
    asset.app_name !== target.artifactId ||
    asset.namespace !== metadata.namespace ||
    asset.catalog_item_id !== metadata.id
  )
    throw new EpicManagedError("invalid-artifact");
  return value;
}

export function parseEpicInstallInfo(
  value: unknown,
  artifactId: string
): {
  downloadSizeInBytes: number;
  diskSizeInBytes: number;
  supportsCloudSaves: boolean;
  version: string;
} {
  if (
    !isRecord(value) ||
    !isRecord(value.game) ||
    value.game.app_name !== artifactId
  )
    throw new EpicManagedError("not-installable");
  const game = value.game;
  const manifest = value.manifest;
  if (
    game.is_dlc !== false ||
    (isRecord(manifest) && manifest.is_preloaded === true)
  )
    throw new EpicManagedError("not-installable");
  const external = game.external_activation;
  if (
    typeof external === "string" &&
    external.trim().length > 0 &&
    external !== "No"
  )
    throw new EpicManagedError("external-launcher-required");
  if (!isRecord(manifest)) throw new EpicManagedError("not-installable");
  if (typeof game.version !== "string" || !game.version)
    throw new EpicManagedError("invalid-response");
  if (
    (external !== false &&
      external !== null &&
      external !== undefined &&
      external !== "No") ||
    manifest.is_preloaded !== false
  )
    throw new EpicManagedError("not-installable");
  const downloadSize = manifest.download_size;
  const diskSize = manifest.disk_size;
  if (
    !Number.isSafeInteger(downloadSize) ||
    Number(downloadSize) < 0 ||
    !Number.isSafeInteger(diskSize) ||
    Number(diskSize) <= 0
  )
    throw new EpicManagedError("invalid-response");
  return {
    downloadSizeInBytes: Number(downloadSize),
    diskSizeInBytes: Number(diskSize),
    supportsCloudSaves: game.cloud_saves_supported === true,
    version: game.version,
  };
}

export class EpicInstallationService {
  readonly runtime: LegendaryManagedRuntime;
  private readonly optionsCache = new Map<
    string,
    SharedEpicRequest<EpicGameInstallOptions>
  >();
  private readonly libraryCache = new Map<
    string,
    SharedEpicRequest<unknown[]>
  >();
  constructor(private readonly options: InstallationOptions) {
    this.runtime = options.runtime;
  }
  private pruneCache<T>(cache: Map<string, SharedEpicRequest<T>>) {
    for (const [key, entry] of cache)
      if (
        entry.expiresAt <= Date.now() ||
        entry.controller.signal.aborted ||
        !this.options.current(entry.context)
      ) {
        cache.delete(key);
        if (!entry.settled) entry.controller.abort();
      }
  }
  private createRequest<T>(
    cache: Map<string, SharedEpicRequest<T>>,
    key: string,
    context: EpicSyncContext,
    ttl: number,
    task: (signal: AbortSignal) => Promise<T>,
    cacheable: (value: T) => boolean = () => true
  ): SharedEpicRequest<T> {
    const controller = new AbortController();
    const entry: SharedEpicRequest<T> = {
      context,
      controller,
      expiresAt: Infinity,
      waiters: 0,
      settled: false,
      promise: Promise.resolve().then(() => task(controller.signal)),
    };
    entry.promise = entry.promise.then(
      (value) => {
        entry.settled = true;
        entry.value = value;
        if (!controller.signal.aborted && cacheable(value))
          entry.expiresAt = Date.now() + ttl;
        else if (cache.get(key) === entry) cache.delete(key);
        return value;
      },
      (error) => {
        entry.settled = true;
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      }
    );
    cache.set(key, entry);
    while (cache.size > EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES)
      cache.delete(cache.keys().next().value!);
    return entry;
  }
  private async waitForRequest<T>(
    cache: Map<string, SharedEpicRequest<T>>,
    key: string,
    entry: SharedEpicRequest<T>,
    signal: AbortSignal
  ): Promise<T> {
    entry.waiters++;
    try {
      return await waitWithSignal(entry.promise, signal);
    } finally {
      entry.waiters--;
      // Closing one modal cannot cancel another consumer of the same preview.
      if (!entry.settled && entry.waiters === 0) {
        if (cache.get(key) === entry) cache.delete(key);
        entry.controller.abort(signal.reason);
      }
    }
  }
  async captureLocal(
    objectId: string,
    signal: AbortSignal
  ): Promise<EpicOwnedGame> {
    if (!isEpicObjectId(objectId))
      throw new EpicManagedError("invalid-artifact");
    const context = this.options.captureLocal?.();
    if (!context || signal.aborted)
      throw new EpicManagedError("stale-connection");
    const game = await this.options.getGame(objectId);
    const owner: EpicLocalOwner = {
      environment: context.auth.environment,
      userId: context.auth.userId,
      epicAccountId: context.connection.epicAccountId,
    };
    if (
      !game ||
      game.isDeleted ||
      game.shop !== "epic" ||
      game.objectId !== objectId ||
      !game.hasActiveEpicImport ||
      game.epicImportScope?.environment !== owner.environment ||
      game.epicImportScope.userId !== owner.userId ||
      game.epicImportScope.connectionId !== context.connection.connectionId ||
      !game.epicInstallation ||
      !epicOwnerMatches(game.epicInstallation.owner, owner) ||
      !isSafeEpicArtifact(game.epicInstallation.artifactId)
    )
      throw new EpicManagedError("game-not-owned");
    const owned = {
      ...context,
      game,
      owner,
      artifactIds: [game.epicInstallation.artifactId],
    };
    const target = {
      ...epicManagedTarget(
        owned,
        game.epicInstallation.artifactId,
        game.epicInstallation.platform
      ),
      localOnly: true as const,
    };
    this.assertPlatform(target.platform);
    await this.metadata(target, objectId);
    this.runtime.assertCurrent(target, signal);
    return owned;
  }
  async capture(objectId: string, signal: AbortSignal): Promise<EpicOwnedGame> {
    if (!isEpicObjectId(objectId))
      throw new EpicManagedError("invalid-artifact");
    const context = await this.options.capture();
    if (signal.aborted || !this.options.current(context))
      throw new EpicManagedError("operation-cancelled");
    const game = await this.options.getGame(objectId);
    if (
      !game ||
      game.isDeleted ||
      game.shop !== "epic" ||
      game.objectId !== objectId ||
      !game.hasActiveEpicImport ||
      game.epicImportScope?.environment !== context.auth.environment ||
      game.epicImportScope.userId !== context.auth.userId ||
      game.epicImportScope.connectionId !== context.connection.connectionId
    )
      throw new EpicManagedError("game-not-owned");
    const owned = await this.options.ownGame(context, objectId, signal);
    if (signal.aborted || !this.options.current(context))
      throw new EpicManagedError("operation-cancelled");
    if (
      !owned?.epicImport ||
      owned.epicImport.connectionId !== context.connection.connectionId ||
      !owned.epicImport.artifactIds.length ||
      owned.epicImport.artifactIds.length > EPIC_MAX_ARTIFACTS ||
      !owned.epicImport.artifactIds.every(isSafeEpicArtifact)
    )
      throw new EpicManagedError("game-not-owned");
    return {
      ...context,
      game,
      artifactIds: [...new Set(owned.epicImport.artifactIds)].sort(
        (left, right) => left.localeCompare(right, "en")
      ),
      owner: {
        environment: context.auth.environment,
        userId: context.auth.userId,
        epicAccountId: context.connection.epicAccountId,
      },
    };
  }
  assertPlatform(platform: EpicInstallPlatform) {
    const support = epicManagedInstallationSupport(
      this.options.platform ?? process.platform,
      this.options.architecture ?? process.arch
    );
    if (!support.available)
      throw new EpicManagedError(support.reason ?? "unsupported-platform");
    if (platform !== "Windows")
      throw new EpicManagedError("unsupported-platform");
  }
  private assertAlias(owned: EpicOwnedGame, target: EpicManagedTarget) {
    this.assertPlatform(target.platform);
    if (
      !owned.artifactIds.includes(target.artifactId) ||
      !isSafeEpicArtifact(target.artifactId) ||
      !epicOwnerMatches(owned.owner, target.owner)
    )
      throw new EpicManagedError("invalid-artifact");
  }
  async metadata(
    target: EpicManagedTarget,
    objectId?: string
  ): Promise<Record<string, unknown>> {
    if (!isSafeEpicArtifact(target.artifactId))
      throw new EpicManagedError("invalid-artifact");
    const value = await readManagedJson(
      path.join(
        this.runtime.workspace(target),
        "metadata",
        `${target.artifactId}.json`
      )
    );
    return validateEpicMetadata(value, target, objectId);
  }
  async prepare(
    owned: EpicOwnedGame,
    artifactId: string,
    platform: EpicInstallPlatform,
    signal: AbortSignal,
    reuseLibrary = false
  ) {
    const target = epicManagedTarget(owned, artifactId, platform);
    this.assertAlias(owned, target);
    try {
      await this.metadata(target, owned.game.objectId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const library = reuseLibrary
        ? await this.previewLibrary(target, signal)
        : await this.runtime.runJson(
            target,
            [
              "list",
              "--json",
              "--include-non-installable",
              "--platform",
              platform,
            ],
            { signal }
          );
      if (!Array.isArray(library))
        throw new EpicManagedError("invalid-response");
      const entries = library.filter(
        (entry) => isRecord(entry) && entry.app_name === artifactId
      );
      if (entries.length !== 1) {
        if (reuseLibrary) this.invalidatePreviewLibrary(target, library);
        throw new EpicManagedError("invalid-artifact");
      }
      let metadata: Record<string, unknown>;
      try {
        metadata = validateEpicMetadata(
          entries[0],
          target,
          owned.game.objectId
        );
      } catch (error) {
        if (
          reuseLibrary &&
          error instanceof EpicManagedError &&
          error.code === "invalid-artifact"
        )
          this.invalidatePreviewLibrary(target, library);
        throw error;
      }
      if (reuseLibrary)
        await this.runtime.serializeWorkspace(
          target,
          async (directory) => {
            this.runtime.assertCurrent(target, signal);
            try {
              await this.metadata(target, owned.game.objectId);
              return;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            const metadataDirectory = path.join(directory, "metadata");
            await fs.mkdir(metadataDirectory, { recursive: true, mode: 0o700 });
            this.runtime.assertCurrent(target, signal);
            await writeManagedJson(
              path.join(metadataDirectory, `${artifactId}.json`),
              metadata
            );
          },
          signal
        );
      // Re-read durable metadata, including cached entries copied to a new workspace.
      await this.metadata(target, owned.game.objectId);
    }
    const info = await this.runtime.runJson(
      target,
      ["info", artifactId, "--json", "--platform", platform],
      { signal }
    );
    await this.metadata(target, owned.game.objectId);
    return { target, ...parseEpicInstallInfo(info, artifactId) };
  }
  private libraryKey(target: EpicManagedTarget) {
    return JSON.stringify([
      target.auth.environment,
      target.auth.userId,
      target.auth.generation,
      target.owner.epicAccountId,
      target.connection.connectionId,
      target.platform,
    ]);
  }
  private invalidatePreviewLibrary(target: EpicManagedTarget, value: unknown) {
    const key = this.libraryKey(target);
    const entry = this.libraryCache.get(key);
    if (entry?.value === value) this.libraryCache.delete(key);
  }
  private async previewLibrary(
    target: EpicManagedTarget,
    signal: AbortSignal,
    refreshMissing = true
  ): Promise<unknown[]> {
    this.pruneCache(this.libraryCache);
    const key = this.libraryKey(target);
    const reused = this.libraryCache.has(key);
    const entry =
      this.libraryCache.get(key) ??
      this.createRequest(
        this.libraryCache,
        key,
        target,
        EPIC_INSTALL_LIBRARY_CACHE_MS,
        async (librarySignal) => {
          const library = await this.runtime.runJson(
            target,
            [
              "list",
              "--json",
              "--include-non-installable",
              "--platform",
              target.platform,
            ],
            { signal: librarySignal }
          );
          if (!Array.isArray(library))
            throw new EpicManagedError("invalid-response");
          return library;
        }
      );
    const library = await this.waitForRequest(
      this.libraryCache,
      key,
      entry,
      signal
    );
    if (
      reused &&
      refreshMissing &&
      !library.some(
        (value) => isRecord(value) && value.app_name === target.artifactId
      )
    ) {
      if (this.libraryCache.get(key) === entry) this.libraryCache.delete(key);
      return this.previewLibrary(target, signal, false);
    }
    return library;
  }
  private optionsKey(context: EpicSyncContext, objectId: string) {
    return JSON.stringify([
      context.auth.environment,
      context.auth.userId,
      context.auth.generation,
      context.connection.epicAccountId,
      context.connection.connectionId,
      objectId,
      "Windows",
    ]);
  }
  async getOptions(
    objectId: string,
    signal?: AbortSignal
  ): Promise<EpicGameInstallOptions> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(
      () => controller.abort(new EpicManagedError("timeout")),
      EPIC_INSTALL_OPTIONS_TIMEOUT_MS
    );
    try {
      return await waitWithSignal(
        this.getOptionsWithSignal(objectId, controller.signal),
        controller.signal
      );
    } catch (error) {
      return { options: [], error: epicManagedErrorCode(error) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  private async getOptionsWithSignal(
    objectId: string,
    signal: AbortSignal
  ): Promise<EpicGameInstallOptions> {
    if (signal.aborted) throw abortError(signal);
    this.assertPlatform("Windows");
    if (!isEpicObjectId(objectId))
      throw new EpicManagedError("invalid-artifact");
    this.pruneCache(this.optionsCache);
    const localContext = this.options.captureLocal?.();
    const context =
      localContext && this.options.current(localContext)
        ? localContext
        : await waitWithSignal(this.options.capture(), signal);
    if (!this.options.current(context) || signal.aborted)
      throw abortError(signal);
    const game = await waitWithSignal(this.options.getGame(objectId), signal);
    if (
      !game ||
      game.isDeleted ||
      game.shop !== "epic" ||
      game.objectId !== objectId ||
      !game.hasActiveEpicImport ||
      game.epicImportScope?.environment !== context.auth.environment ||
      game.epicImportScope.userId !== context.auth.userId ||
      game.epicImportScope.connectionId !== context.connection.connectionId
    )
      throw new EpicManagedError("game-not-owned");
    if (!this.options.current(context) || signal.aborted)
      throw new EpicManagedError("operation-cancelled");
    const key = this.optionsKey(context, objectId);
    let entry = this.optionsCache.get(key);
    const reused = !!entry;
    if (!entry) {
      entry = this.createRequest(
        this.optionsCache,
        key,
        context,
        EPIC_INSTALL_OPTIONS_CACHE_MS,
        (requestSignal) => this.loadOptions(objectId, requestSignal, context),
        (result) => !result.error && result.options.length > 0
      );
    }
    const result = await this.waitForRequest(
      this.optionsCache,
      key,
      entry,
      signal
    );
    if (!this.options.current(context) || signal.aborted)
      throw new EpicManagedError("operation-cancelled");
    if (result.error || !result.options.length) {
      if (this.optionsCache.get(key) === entry) this.optionsCache.delete(key);
      return result;
    }
    // Cached options are a preview, never authorization to install. Start still
    // captures ownership and runs prepare again with fresh Legendary info.
    const owner: EpicLocalOwner = {
      environment: context.auth.environment,
      userId: context.auth.userId,
      epicAccountId: context.connection.epicAccountId,
    };
    const options = await Promise.all(
      result.options.map(async (option) => ({
        ...option,
        ...(reused
          ? {
              installed: !!(await this.readInstalledForRepair(
                {
                  ...context,
                  owner,
                  artifactId: option.artifactId,
                  platform: option.platform,
                },
                objectId
              )),
            }
          : {}),
      }))
    );
    if (!this.options.current(context) || signal.aborted)
      throw new EpicManagedError("operation-cancelled");
    return { ...result, options };
  }
  private async loadOptions(
    objectId: string,
    signal: AbortSignal,
    expectedContext?: EpicSyncContext
  ): Promise<EpicGameInstallOptions> {
    try {
      this.assertPlatform("Windows");
      const owned = await this.capture(objectId, signal);
      if (
        expectedContext &&
        (!this.options.current(expectedContext) ||
          this.optionsKey(expectedContext, objectId) !==
            this.optionsKey(owned, objectId))
      )
        throw new EpicManagedError("operation-cancelled");
      const options: EpicGameInstallOption[] = [];
      let invalid: unknown;
      for (const artifactId of owned.artifactIds) {
        try {
          const prepared = await this.prepare(
            owned,
            artifactId,
            "Windows",
            signal,
            true
          );
          const installed = await this.readInstalledForRepair(
            prepared.target,
            objectId
          );
          options.push({
            artifactId,
            platform: "Windows",
            downloadSizeInBytes: prepared.downloadSizeInBytes,
            diskSizeInBytes: prepared.diskSizeInBytes,
            supportsCloudSaves: prepared.supportsCloudSaves,
            installed: !!installed,
          });
        } catch (error) {
          if (
            error instanceof EpicManagedError &&
            [
              "invalid-artifact",
              "not-installable",
              "external-launcher-required",
            ].includes(error.code)
          )
            invalid =
              invalid instanceof EpicManagedError &&
              invalid.code === "external-launcher-required"
                ? invalid
                : error;
          else throw error;
        }
      }
      return {
        connectionId: owned.connection.connectionId,
        options,
        ...(!options.length
          ? {
              error:
                invalid instanceof EpicManagedError
                  ? invalid.code
                  : ("not-installable" as const),
            }
          : {}),
      };
    } catch (error) {
      return {
        options: [],
        error: epicManagedErrorCode(error),
      };
    }
  }
  async readInstalledForRepair(
    target: EpicManagedTarget,
    expectedObjectId?: string,
    expectedInstallPath?: string
  ): Promise<EpicInstalledGame | null> {
    try {
      return await this.readInstalled(
        target,
        expectedObjectId,
        expectedInstallPath
      );
    } catch (error) {
      if (
        error instanceof EpicManagedError &&
        error.code === "installation-incomplete"
      )
        return null;
      throw error;
    }
  }
  async readInstalled(
    target: EpicManagedTarget,
    expectedObjectId?: string,
    expectedInstallPath?: string
  ): Promise<EpicInstalledGame | null> {
    let value;
    try {
      value = await readManagedJson(
        path.join(this.runtime.workspace(target), "installed.json")
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!isRecord(value)) throw new EpicManagedError("invalid-response");
    const raw = value[target.artifactId];
    if (raw === undefined) return null;
    if (
      !isRecord(raw) ||
      raw.app_name !== target.artifactId ||
      raw.platform !== target.platform ||
      raw.is_dlc === true ||
      raw.is_preloaded === true ||
      typeof raw.version !== "string" ||
      !raw.version ||
      typeof raw.install_path !== "string" ||
      !path.isAbsolute(raw.install_path) ||
      typeof raw.executable !== "string" ||
      !raw.executable ||
      !Number.isSafeInteger(raw.install_size) ||
      Number(raw.install_size) <= 0
    )
      throw new EpicManagedError("installation-incomplete");
    const metadata = await this.metadata(target, expectedObjectId);
    const installPath = await fs.realpath(raw.install_path).catch(() => null);
    if (!installPath) return null;
    const installStat = await fs.lstat(raw.install_path);
    if (
      !installStat.isDirectory() ||
      installStat.isSymbolicLink() ||
      path.relative(raw.install_path, installPath) !== ""
    )
      throw new EpicManagedError("invalid-path");
    if (expectedInstallPath) {
      const expected = await fs.realpath(expectedInstallPath).catch(() => null);
      if (!expected || path.relative(expected, installPath) !== "")
        throw new EpicManagedError("invalid-path");
    }
    // Legendary strips a manifest-root slash and resolves relative to install_path.
    const manifestExe = raw.executable.replaceAll("\\", "/");
    if (/^[a-zA-Z]:/.test(manifestExe) || manifestExe.startsWith("//"))
      throw new EpicManagedError("invalid-path");
    const normalizedExe = manifestExe
      .replace(/^\/+/, "")
      .replaceAll("/", path.sep);
    if (path.isAbsolute(normalizedExe))
      throw new EpicManagedError("invalid-path");
    const candidate = path.resolve(installPath, normalizedExe);
    if (!isPathContained(installPath, candidate))
      throw new EpicManagedError("invalid-path");
    const executablePath = await resolveEpicWindowsPath(
      installPath,
      normalizedExe
    );
    if (
      !executablePath ||
      !isPathContained(installPath, executablePath) ||
      !(await fs.stat(executablePath)).isFile()
    )
      return null;
    // Keep ownership and path validation strict even for an unfinished install.
    if (raw.needs_verification === true)
      throw new EpicManagedError("installation-incomplete");
    return {
      ...raw,
      raw,
      metadata,
      app_name: target.artifactId,
      platform: target.platform,
      version: raw.version,
      install_path: raw.install_path,
      executable: raw.executable,
      install_size: Number(raw.install_size),
      installPath,
      executablePath,
    } as EpicInstalledGame;
  }
  async confirmPrerequisites(
    target: EpicManagedTarget,
    installed: EpicInstalledGame,
    signal: AbortSignal
  ) {
    if (!installed.prereq_info) return;
    await this.runtime.serializeWorkspace(
      target,
      async (directory) => {
        this.runtime.assertCurrent(target, signal);
        const file = path.join(directory, "installed.json");
        const values = await readManagedJson(file);
        const entry = isRecord(values) ? values[target.artifactId] : null;
        if (
          !isRecord(values) ||
          !isRecord(entry) ||
          !isRecord(entry.prereq_info) ||
          entry.version !== installed.version ||
          entry.install_path !== installed.install_path
        )
          throw new EpicManagedError("installation-incomplete");
        entry.prereq_info.installed = true;
        await writeManagedJson(file, values);
      },
      signal
    );
  }
  async folderName(target: EpicManagedTarget, objectId: string) {
    const entry = await this.metadata(target, objectId);
    const metadata = entry.metadata as Record<string, unknown>;
    const attributes = isRecord(metadata.customAttributes)
      ? metadata.customAttributes
      : {};
    const folder = isRecord(attributes.FolderName)
      ? attributes.FolderName.value
      : target.artifactId;
    if (
      typeof folder !== "string" ||
      !folder ||
      folder.length > 255 ||
      /[<>:"/\\|?*]/.test(folder) ||
      [...folder].some((character) => character.charCodeAt(0) <= 0x1f) ||
      /[. ]$/.test(folder) ||
      folder === "." ||
      folder === ".." ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)
    )
      throw new EpicManagedError("invalid-path");
    return folder;
  }
  async bind(
    owned: EpicOwnedGame,
    target: EpicManagedTarget,
    installed: EpicInstalledGame,
    signal?: AbortSignal
  ) {
    this.runtime.assertCurrent(target, signal);
    const updated = await this.options.updateGame(
      owned.game.objectId,
      (latest) => {
        this.runtime.assertCurrent(target, signal);
        if (
          latest.isDeleted ||
          latest.shop !== "epic" ||
          latest.objectId !== owned.game.objectId
        )
          throw new EpicManagedError("game-not-owned");
        if (
          !latest.hasActiveEpicImport ||
          latest.epicImportScope?.connectionId !==
            target.connection.connectionId ||
          latest.epicImportScope.environment !== target.auth.environment ||
          latest.epicImportScope.userId !== target.auth.userId
        )
          throw new EpicManagedError("stale-connection");
        const sameInstallation =
          latest.epicInstallation &&
          epicOwnerMatches(latest.epicInstallation.owner, target.owner) &&
          latest.epicInstallation.artifactId === target.artifactId &&
          latest.epicInstallation.platform === target.platform;
        return {
          executablePath: installed.executablePath,
          executablePathUpdatedAt: new Date(),
          installedSizeInBytes: installed.install_size,
          epicInstallation: {
            ...(sameInstallation ? latest.epicInstallation : {}),
            owner: target.owner,
            artifactId: target.artifactId,
            platform: target.platform,
          },
        };
      }
    );
    if (!updated) throw new EpicManagedError("game-not-owned");
    return updated;
  }
  async forgetInstallation(target: EpicManagedTarget) {
    await this.runtime.serializeWorkspace(target, async (directory) => {
      const file = path.join(directory, "installed.json");
      let value;
      try {
        value = await readManagedJson(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (!isRecord(value)) throw new EpicManagedError("invalid-response");
      delete value[target.artifactId];
      await writeManagedJson(file, value);
    });
  }
}
