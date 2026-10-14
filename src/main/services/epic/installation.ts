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
import {
  EPIC_SYNC_MAX_OUTPUT_BYTES,
  EPIC_MAX_ARTIFACTS,
  EPIC_INSTALL_OPTIONS_CACHE_MS,
  EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES,
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
    !isRecord(value.metadata) ||
    !isRecord(value.asset_infos)
  )
    throw new EpicManagedError("invalid-artifact");
  const metadata = value.metadata;
  const asset = value.asset_infos[target.platform];
  if (
    !isRecord(asset) ||
    asset.app_name !== target.artifactId ||
    asset.namespace !== metadata.namespace ||
    asset.catalog_item_id !== metadata.id ||
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
    value.game.app_name !== artifactId ||
    !isRecord(value.manifest)
  )
    throw new EpicManagedError("not-installable");
  const game = value.game;
  const manifest = value.manifest;
  if (typeof game.version !== "string" || !game.version)
    throw new EpicManagedError("invalid-response");
  const external = game.external_activation;
  if (
    game.is_dlc !== false ||
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
    {
      context: EpicSyncContext;
      expiresAt: number;
      promise: Promise<EpicGameInstallOptions>;
    }
  >();
  constructor(private readonly options: InstallationOptions) {
    this.runtime = options.runtime;
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
    // Other platform builds are intentionally not advertised before validation.
    if (
      (this.options.platform ?? process.platform) !== "win32" ||
      platform !== "Windows"
    )
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
    signal: AbortSignal
  ) {
    const target = epicManagedTarget(owned, artifactId, platform);
    this.assertAlias(owned, target);
    try {
      await this.metadata(target, owned.game.objectId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const library = await this.runtime.runJson(
        target,
        ["list", "--json", "--include-non-installable", "--platform", platform],
        { signal }
      );
      if (!Array.isArray(library))
        throw new EpicManagedError("invalid-response");
      const entries = library.filter(
        (entry) => isRecord(entry) && entry.app_name === artifactId
      );
      if (entries.length !== 1) throw new EpicManagedError("invalid-artifact");
      validateEpicMetadata(entries[0], target, owned.game.objectId);
      // Legendary writes its verified metadata while listing; re-read the durable file.
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
  async getOptions(objectId: string): Promise<EpicGameInstallOptions> {
    try {
      this.assertPlatform("Windows");
      if (!isEpicObjectId(objectId))
        throw new EpicManagedError("invalid-artifact");
      for (const [key, entry] of this.optionsCache)
        if (
          entry.expiresAt <= Date.now() ||
          !this.options.current(entry.context)
        )
          this.optionsCache.delete(key);
      const context = this.options.captureLocal?.();
      if (!context || !this.options.current(context))
        return this.loadOptions(objectId);
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
      if (!this.options.current(context))
        throw new EpicManagedError("operation-cancelled");
      const key = this.optionsKey(context, objectId);
      let entry = this.optionsCache.get(key);
      const reused = !!entry;
      if (!entry) {
        entry = {
          context,
          expiresAt: Infinity,
          promise: this.loadOptions(objectId, context),
        };
        this.optionsCache.set(key, entry);
        while (this.optionsCache.size > EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES)
          this.optionsCache.delete(this.optionsCache.keys().next().value!);
      }
      const result = await entry.promise;
      if (!this.options.current(context))
        throw new EpicManagedError("operation-cancelled");
      if (result.error || !result.options.length) {
        if (this.optionsCache.get(key) === entry) this.optionsCache.delete(key);
        return result;
      }
      if (!reused) entry.expiresAt = Date.now() + EPIC_INSTALL_OPTIONS_CACHE_MS;
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
      if (!this.options.current(context))
        throw new EpicManagedError("operation-cancelled");
      return { ...result, options };
    } catch (error) {
      return { options: [], error: epicManagedErrorCode(error) };
    }
  }
  private async loadOptions(
    objectId: string,
    expectedContext?: EpicSyncContext
  ): Promise<EpicGameInstallOptions> {
    const controller = new AbortController();
    try {
      this.assertPlatform("Windows");
      const owned = await this.capture(objectId, controller.signal);
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
            controller.signal
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
            ["invalid-artifact", "not-installable"].includes(error.code)
          )
            invalid = error;
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
    } finally {
      controller.abort();
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
    const executablePath = await fs.realpath(candidate).catch(() => null);
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
