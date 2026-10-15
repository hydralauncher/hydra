import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { app } from "electron";
import stringArgv from "string-argv";
import type { Game, UserPreferences } from "@types";
import type { EpicLocalOwner } from "../../../types/epic-managed.types";
import { db, levelKeys } from "@main/level";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";
import { parseLaunchOptions } from "@main/events/helpers/parse-launch-options";
import { SystemPath } from "../system-path";
import { Wine } from "../wine";
import { Umu } from "../umu";
import { getLegendaryLinuxPythonRunnerPath } from "../legendary-runtime-paths";
import {
  hasLinuxPrefixProcesses,
  type UmuProcessHandle,
} from "../umu-supervised-process";
import {
  EpicManagedError,
  managedWorkspacePath,
  type EpicManagedTarget,
} from "./legendary-managed-runtime";
import type { EpicInstalledGame } from "./installation";
import type { EpicLaunchParameters } from "./launch-protocol";
import type { UmuStatusListener } from "../umu-launch-monitor";
import { observeEpicLinuxLaunch } from "./linux-launch-monitor.js";
import { resolveEpicWindowsPath } from "./windows-path";
import { EPIC_PREREQUISITE_TIMEOUT_MS } from "./constants";
import {
  EPIC_LINUX_PATH_TIMEOUT_MS,
  EPIC_LINUX_PREFIX_ID_FILE,
  EPIC_LINUX_PREPARE_TIMEOUT_MS,
  EPIC_LINUX_RECEIPT_FILE,
  EPIC_LINUX_RECEIPT_MAX_BYTES,
  EPIC_LINUX_RECEIPT_SCHEMA,
} from "./linux-runtime-constants";
import {
  epicLinuxDigest,
  epicLinuxPrefixKey,
  epicLinuxPrerequisiteIdentity,
  EpicLinuxProtonPathDecoder,
  parseEpicLinuxMappedPath,
  parseEpicPrerequisiteResult,
} from "./linux-runtime-protocol";
import umuMap from "../../../shared/epic-umu-map.json";

export interface PreparedEpicLinuxContext {
  pythonRunnerPath: string;
  umuBinaryPath: string;
  umuVersion: string;
  umuFingerprint: string;
  installPath: string;
  protonPath: string;
  protonFingerprint: string;
  winePrefixPath: string;
  prefixGeneration: string;
  gameId: string;
  store: "egs";
  offline: boolean;
}
interface PreparationOptions {
  signal: AbortSignal;
  offline?: boolean;
  buildVersion?: string;
  installPath?: string;
  onStatus?: UmuStatusListener;
}
interface LinuxReceipt {
  schemaVersion: number;
  umuVersion: string;
  umuFingerprint: string;
  artifactId: string;
  platform: "Windows";
  buildVersion: string | null;
  installPath: string;
  winePrefixPath: string;
  prefixGeneration: string;
  protonPath: string;
  protonFingerprint: string;
  prerequisite?: string;
}
const prefixQueues = new Map<string, Promise<unknown>>();
const activePrefixes = new Map<string, string>();
interface PendingPrefixCleanup {
  handles: Set<UmuProcessHandle>;
  release?: () => void;
  retry?: Promise<void>;
}
const pendingPrefixCleanups = new Map<string, PendingPrefixCleanup>();
export interface EpicLinuxPrefixLease {
  id: string;
  release(): void;
}
const assertSignal = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new EpicManagedError("operation-cancelled");
};
const privateJson = async (file: string): Promise<unknown> => {
  const info = await fs.lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > EPIC_LINUX_RECEIPT_MAX_BYTES
  )
    throw new EpicManagedError("invalid-path");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
async function writePrivateJson(file: string, value: unknown) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
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
const fileHash = async (file: string, signal?: AbortSignal) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
};
async function serializePrefix<T>(
  prefix: string,
  signal: AbortSignal,
  operation: () => Promise<T>
) {
  const previous = prefixQueues.get(prefix) ?? Promise.resolve();
  let started = false;
  const pending = previous
    .catch(() => undefined)
    .then(async () => {
      assertSignal(signal);
      started = true;
      return operation();
    });
  prefixQueues.set(prefix, pending);
  void pending
    .finally(() => {
      if (prefixQueues.get(prefix) === pending) prefixQueues.delete(prefix);
    })
    .catch(() => undefined);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    // A queued waiter can leave immediately. An executing operation owns its
    // process lease until its signal handler confirms termination.
    abort = () => {
      if (!started) reject(new EpicManagedError("operation-cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
type ReceiptTarget = Pick<
  EpicManagedTarget,
  "owner" | "artifactId" | "platform"
>;
const receiptPath = (target: ReceiptTarget) =>
  path.join(
    managedWorkspacePath(
      SystemPath.getPath("userData"),
      target.owner,
      target.artifactId,
      target.platform
    ),
    EPIC_LINUX_RECEIPT_FILE
  );
const prerequisiteHelperPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "epic", "epic-prerequisite-runner.exe")
    : path.join(
        __dirname,
        "..",
        "..",
        "binaries",
        "epic-prerequisite-runner",
        "x64",
        "epic-prerequisite-runner.exe"
      );
async function loadReceipt(
  target: ReceiptTarget
): Promise<LinuxReceipt | null> {
  try {
    const value = (await privateJson(receiptPath(target))) as LinuxReceipt;
    return value?.schemaVersion === EPIC_LINUX_RECEIPT_SCHEMA &&
      typeof value.protonPath === "string" &&
      typeof value.winePrefixPath === "string" &&
      typeof value.prefixGeneration === "string" &&
      typeof value.protonFingerprint === "string" &&
      typeof value.umuVersion === "string" &&
      typeof value.umuFingerprint === "string" &&
      typeof value.installPath === "string" &&
      path.isAbsolute(value.installPath) &&
      value.artifactId === target.artifactId &&
      value.platform === target.platform &&
      (value.buildVersion === null || typeof value.buildVersion === "string")
      ? value
      : null;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return null;
    throw error;
  }
}

/** Reads the last artifact context without selecting/downloading any runtime. */
export async function getEpicLinuxLastPreparedPrefix(
  game: Game
): Promise<string | null> {
  const installed = game.epicInstallation;
  if (!installed || installed.platform !== "Windows") return null;
  const receipt = await loadReceipt({
    owner: installed.owner,
    artifactId: installed.artifactId,
    platform: installed.platform,
  });
  if (!receipt || !path.isAbsolute(receipt.winePrefixPath)) return null;
  return Wine.resolvePrefixPath(receipt.winePrefixPath);
}
async function preferences() {
  return db
    .get<
      string,
      UserPreferences | null
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => null);
}

export async function resolveEpicLinuxPrefixPath(
  game: Game,
  owner: EpicLocalOwner,
  artifactId: string
) {
  const configured = await preferences();
  const root =
    configured?.defaultWinePrefixPath ??
    Wine.getDefaultPrefixPath() ??
    path.join(SystemPath.getPath("userData"), "wine-prefixes");
  const requested =
    game.winePrefixPath ||
    path.join(root, "epic", epicLinuxPrefixKey(owner, artifactId));
  const resolved = await Wine.resolvePrefixPath(requested);
  if (!resolved || !path.isAbsolute(resolved))
    throw new EpicManagedError("compatibility-prefix-invalid");
  return resolved;
}

async function selectedProton(game: Game) {
  if (game.protonPath && Umu.isValidProtonPath(game.protonPath))
    return {
      path: await fs.realpath(game.protonPath),
      source: "game" as const,
    };
  const configured = await preferences();
  if (
    configured?.defaultProtonPath &&
    Umu.isValidProtonPath(configured.defaultProtonPath)
  )
    return {
      path: await fs.realpath(configured.defaultProtonPath),
      source: "global" as const,
    };
  return { path: "UMU-Proton", source: "umu" as const };
}

export async function getEpicLinuxCompatibility(game: Game) {
  if (!game.epicInstallation)
    throw new EpicManagedError("installation-missing");
  const selected = await selectedProton(game);
  return {
    winePrefixPath: await resolveEpicLinuxPrefixPath(
      game,
      game.epicInstallation.owner,
      game.epicInstallation.artifactId
    ),
    protonName:
      selected.source === "umu" ? "UMU-Proton" : path.basename(selected.path),
    protonSource: selected.source,
  };
}

async function protonFingerprint(directory: string) {
  const real = await fs.realpath(directory);
  if (!Umu.isValidProtonPath(real))
    throw new EpicManagedError("compatibility-runtime-unavailable");
  return epicLinuxDigest([
    real,
    await fileHash(path.join(real, "proton")),
    await fileHash(path.join(real, "toolmanifest.vdf")),
  ]);
}
async function prefixGeneration(prefix: string, forceNew = false) {
  if (!Wine.isPrefixReadyForRestore(prefix))
    throw new EpicManagedError("compatibility-prefix-invalid");
  const info = await fs.stat(prefix);
  const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
  const marker = path.join(prefix, EPIC_LINUX_PREFIX_ID_FILE);
  try {
    const stored = (await privateJson(marker)) as {
      generation?: string;
      identity?: string;
    };
    if (
      !forceNew &&
      stored.identity === identity &&
      typeof stored.generation === "string" &&
      /^[a-f0-9-]{36}$/.test(stored.generation)
    )
      return stored.generation;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      !(error instanceof SyntaxError)
    )
      throw error;
  }
  const generation = randomUUID();
  await writePrivateJson(marker, { generation, identity });
  return generation;
}
export async function getEpicLinuxPrefixGeneration(
  prefix: string
): Promise<string | null> {
  if (!Wine.isPrefixReadyForRestore(prefix)) return null;
  try {
    const info = await fs.stat(prefix);
    const value = (await privateJson(
      path.join(prefix, EPIC_LINUX_PREFIX_ID_FILE)
    )) as { identity?: string; generation?: string };
    return value.identity === `${info.dev}:${info.ino}:${info.birthtimeMs}` &&
      typeof value.generation === "string"
      ? value.generation
      : null;
  } catch {
    return null;
  }
}
async function retryPrefixCleanup(prefix: string) {
  const pending = pendingPrefixCleanups.get(prefix);
  if (!pending) return;
  pending.retry ??= (async () => {
    while (pending.handles.size) {
      await Promise.all(
        [...pending.handles].map(async (handle) => {
          await handle.terminate();
          pending.handles.delete(handle);
        })
      );
    }
    pending.release?.();
    pendingPrefixCleanups.delete(prefix);
  })().catch(() => {
    pending.retry = undefined;
    throw new EpicManagedError("cleanup-failed");
  });
  return pending.retry;
}

/** Retained preparation handles remain owned until a later cleanup proves exit. */
export async function retryEpicLinuxCleanup(prefix?: string) {
  const prefixes = prefix ? [prefix] : [...pendingPrefixCleanups.keys()];
  const results = await Promise.allSettled(
    prefixes.map((value) =>
      serializePrefix(value, new AbortController().signal, () =>
        retryPrefixCleanup(value)
      )
    )
  );
  if (results.some((result) => result.status === "rejected"))
    throw new EpicManagedError("cleanup-failed");
}

async function reservePrefix(prefix: string): Promise<EpicLinuxPrefixLease> {
  await retryPrefixCleanup(prefix);
  if (activePrefixes.has(prefix))
    throw new EpicManagedError("compatibility-prefix-busy");
  const id = randomUUID();
  // Reserve synchronously before checking /proc so competing callers cannot pass.
  activePrefixes.set(prefix, id);
  const release = () => {
    if (activePrefixes.get(prefix) === id) activePrefixes.delete(prefix);
  };
  try {
    if (await hasLinuxPrefixProcesses(prefix))
      throw new EpicManagedError("compatibility-prefix-busy");
    return { id, release };
  } catch (error) {
    release();
    throw error;
  }
}

export async function acquireEpicLinuxPrefixSession(
  context: PreparedEpicLinuxContext,
  signal = new AbortController().signal
): Promise<EpicLinuxPrefixLease> {
  return serializePrefix(context.winePrefixPath, signal, async () => {
    const lease = await reservePrefix(context.winePrefixPath);
    try {
      assertSignal(signal);
      return lease;
    } catch (error) {
      lease.release();
      throw error;
    }
  });
}

/** Shared by manual saves and the launch lease; never mutates a running prefix. */
export async function withEpicLinuxPrefixMutation<T>(
  prefix: string,
  task: () => Promise<T>,
  allowedLeaseId?: string,
  signal = new AbortController().signal
): Promise<T> {
  return serializePrefix(prefix, signal, async () => {
    if (allowedLeaseId) {
      if (activePrefixes.get(prefix) !== allowedLeaseId)
        throw new EpicManagedError("compatibility-prefix-busy");
      return task();
    }
    const lease = await reservePrefix(prefix);
    try {
      assertSignal(signal);
      return await task();
    } finally {
      const cleanup = pendingPrefixCleanups.get(prefix);
      if (cleanup) cleanup.release = lease.release;
      else lease.release();
    }
  });
}
function runtimeEnvironment(
  context: Pick<
    PreparedEpicLinuxContext,
    "winePrefixPath" | "protonPath" | "gameId" | "offline" | "installPath"
  >
) {
  return {
    WINEPREFIX: context.winePrefixPath,
    PROTONPATH: context.protonPath,
    STORE: "egs",
    GAMEID: context.gameId,
    STEAM_COMPAT_INSTALL_PATH: context.installPath,
    PROTON_VERB: "waitforexitandrun",
    PROTON_LOG: "0",
    PROTON_DUMP_DEBUG_COMMANDS: "0",
    UMU_LOG: "error",
    UMU_RUNTIME_UPDATE: context.offline ? "0" : "1",
    // UMU 1.4.4 tests truthiness: "0" suppresses both Zenity and Python download.
    UMU_ZENITY: "",
    UMU_NO_PROTON: "0",
    UMU_NO_RUNTIME: "0",
    UMU_CONTAINER_NSENTER: "0",
    LEGENDARY_WRAPPER_EXE: "",
  };
}

async function runTool(
  context: PreparedEpicLinuxContext,
  executable: string,
  args: string[],
  options: PreparationOptions & {
    cwd?: string;
    verb?: string;
    captureOutput?: boolean;
    onLine?: (line: string) => void;
    timeoutMs?: number;
    debug?: boolean;
  }
) {
  assertSignal(options.signal);
  const handle = await Umu.launchSupervised({
    executable: context.pythonRunnerPath,
    args: [context.umuBinaryPath, executable, ...args],
    cwd: options.cwd ?? context.winePrefixPath,
    environment: {
      ...process.env,
      ...runtimeEnvironment(context),
      PROTON_VERB: options.verb ?? "waitforexitandrun",
      UMU_LOG: options.debug ? "debug" : "error",
    },
    signal: options.signal,
    captureOutput: options.captureOutput,
    onLine: options.onLine,
    timeoutMs: options.timeoutMs ?? EPIC_LINUX_PREPARE_TIMEOUT_MS,
  });
  try {
    // Observe cancellation/cleanup alongside wrapper exit: failed termination
    // can leave the wrapper alive, so awaiting exited first would never settle.
    const [exit, output] = await Promise.all([
      handle.exited,
      handle.output,
      handle.waitForTreeExit(),
    ]);
    assertSignal(options.signal);
    if (exit.code !== 0 || exit.signal)
      throw new EpicManagedError("compatibility-runtime-download-failed");
    return output;
  } catch (error) {
    try {
      await handle.terminate();
    } catch {
      const pending = pendingPrefixCleanups.get(context.winePrefixPath) ?? {
        handles: new Set<UmuProcessHandle>(),
      };
      pending.handles.add(handle);
      pendingPrefixCleanups.set(context.winePrefixPath, pending);
      throw new EpicManagedError("cleanup-failed");
    }
    throw error;
  }
}

export async function prepareEpicLinuxRuntime(
  game: Game,
  target: EpicManagedTarget,
  options: PreparationOptions & { installPath: string }
): Promise<PreparedEpicLinuxContext> {
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    target.platform !== "Windows"
  )
    throw new EpicManagedError("unsupported-platform");
  const prefix = await resolveEpicLinuxPrefixPath(
    game,
    target.owner,
    target.artifactId
  );
  return withEpicLinuxPrefixMutation(
    prefix,
    () =>
      prepareUnlocked(
        game,
        target,
        prefix,
        options,
        options.buildVersion ?? null
      ),
    undefined,
    options.signal
  );
}

async function prepareUnlocked(
  game: Game,
  target: EpicManagedTarget,
  prefix: string,
  options: PreparationOptions,
  buildVersion: string | null = null
): Promise<PreparedEpicLinuxContext> {
  assertSignal(options.signal);
  if (
    typeof options.installPath !== "string" ||
    !path.isAbsolute(options.installPath)
  )
    throw new EpicManagedError("invalid-path");
  const installPath = await fs.realpath(options.installPath).catch(() => {
    throw new EpicManagedError("invalid-path");
  });
  if (!(await fs.stat(installPath)).isDirectory())
    throw new EpicManagedError("invalid-path");
  if (await hasLinuxPrefixProcesses(prefix))
    throw new EpicManagedError("compatibility-prefix-busy");
  const pythonRunnerPath = await getLegendaryLinuxPythonRunnerPath().catch(
    () => {
      throw new EpicManagedError("compatibility-runtime-unavailable");
    }
  );
  const selectedUmu = Umu.getSupervisedRuntime();
  const umuBinaryPath = selectedUmu.binaryPath;
  if ((await fileHash(umuBinaryPath)) !== selectedUmu.sha256)
    throw new EpicManagedError("compatibility-runtime-unavailable");
  const selected = await selectedProton(game);
  const receipt = await loadReceipt(target);
  if (receipt && receipt.winePrefixPath !== prefix) {
    if (!path.isAbsolute(receipt.winePrefixPath))
      throw new EpicManagedError("compatibility-prefix-invalid");
    const previousPrefix = await Wine.resolvePrefixPath(receipt.winePrefixPath);
    if (
      !previousPrefix ||
      activePrefixes.has(previousPrefix) ||
      (await hasLinuxPrefixProcesses(previousPrefix))
    )
      throw new EpicManagedError("compatibility-prefix-busy");
  }
  const key = target.artifactId.toLowerCase();
  const gameId = Object.hasOwn(umuMap.entries, key)
    ? (umuMap.entries as Record<string, string>)[key]
    : "umu-default";
  const hadPrefix = Wine.isPrefixReadyForRestore(prefix);
  const context: PreparedEpicLinuxContext = {
    pythonRunnerPath,
    umuBinaryPath,
    umuVersion: selectedUmu.version,
    umuFingerprint: selectedUmu.sha256,
    installPath,
    protonPath: selected.path,
    protonFingerprint: "",
    winePrefixPath: prefix,
    prefixGeneration: "",
    gameId,
    store: "egs",
    offline: options.offline === true,
  };
  if (context.offline) {
    if (
      !receipt ||
      buildVersion === null ||
      receipt.buildVersion !== buildVersion ||
      receipt.umuVersion !== context.umuVersion ||
      receipt.umuFingerprint !== context.umuFingerprint ||
      receipt.installPath !== context.installPath ||
      receipt.winePrefixPath !== prefix ||
      !hadPrefix ||
      !path.isAbsolute(receipt.protonPath) ||
      (selected.source !== "umu" && selected.path !== receipt.protonPath)
    )
      throw new EpicManagedError("compatibility-runtime-unavailable");
    context.protonPath = await fs.realpath(receipt.protonPath).catch(() => {
      throw new EpicManagedError("compatibility-runtime-unavailable");
    });
    context.protonFingerprint = await protonFingerprint(context.protonPath);
    context.prefixGeneration =
      (await getEpicLinuxPrefixGeneration(prefix)) ?? "";
    if (
      context.protonFingerprint !== receipt.protonFingerprint ||
      context.prefixGeneration !== receipt.prefixGeneration
    )
      throw new EpicManagedError("compatibility-runtime-unavailable");
    return context;
  }
  await fs.mkdir(prefix, { recursive: true, mode: 0o700 });
  options.onStatus?.({ type: "progress", message: null });
  const decoder = new EpicLinuxProtonPathDecoder();
  const helper = prerequisiteHelperPath();
  if (!(await fs.stat(helper).catch(() => null))?.isFile())
    throw new EpicManagedError("compatibility-runtime-unavailable");
  // UMU createprefix intentionally exits 1. A shipped benign PE probe instead
  // proves that prefix initialization and real Windows execution both succeeded.
  await runTool(context, helper, ["--probe"], {
    ...options,
    captureOutput: true,
    debug: true,
    onLine: (line) => decoder.push(`${line}\n`),
  }).catch((error) => {
    if ((error as { code?: string }).code === "cleanup-failed") throw error;
    if (options.signal.aborted)
      throw new EpicManagedError("operation-cancelled");
    throw new EpicManagedError("compatibility-runtime-download-failed");
  });
  const effective = decoder.finish();
  if (!effective)
    throw new EpicManagedError("compatibility-runtime-unavailable");
  context.protonPath = await fs.realpath(effective);
  context.protonFingerprint = await protonFingerprint(context.protonPath);
  context.prefixGeneration = await prefixGeneration(prefix, !hadPrefix);
  assertSignal(options.signal);
  await writePrivateJson(receiptPath(target), {
    schemaVersion: EPIC_LINUX_RECEIPT_SCHEMA,
    umuVersion: context.umuVersion,
    umuFingerprint: context.umuFingerprint,
    artifactId: target.artifactId,
    platform: target.platform,
    buildVersion,
    installPath: context.installPath,
    winePrefixPath: prefix,
    prefixGeneration: context.prefixGeneration,
    protonPath: context.protonPath,
    protonFingerprint: context.protonFingerprint,
    ...(receipt?.prefixGeneration === context.prefixGeneration &&
    receipt.protonFingerprint === context.protonFingerprint &&
    receipt.umuVersion === context.umuVersion &&
    receipt.umuFingerprint === context.umuFingerprint &&
    receipt.buildVersion === buildVersion &&
    receipt.installPath === context.installPath
      ? { prerequisite: receipt.prerequisite }
      : {}),
  });
  options.onStatus?.({ type: "ready" });
  return context;
}

export async function mapEpicLinuxPath(
  context: PreparedEpicLinuxContext,
  posixPath: string,
  signal = new AbortController().signal
) {
  const real = await fs.realpath(posixPath).catch(() => null);
  // Proton's getnativepath requires an existing path. Map and roundtrip the
  // existing parent, then append only a validated Windows basename for output.
  if (!real) {
    const name = path.basename(posixPath);
    if (!name || name === "." || name === ".." || /[<>:"|?*\\\0]/.test(name))
      throw new EpicManagedError("invalid-path");
    return path.win32.join(
      await mapEpicLinuxPath(
        context,
        await fs.realpath(path.dirname(posixPath)),
        signal
      ),
      name
    );
  }
  const canonical = real;
  if (!path.isAbsolute(canonical) || canonical.includes("\0"))
    throw new EpicManagedError("invalid-path");
  const mapped = parseEpicLinuxMappedPath(
    (
      await runTool(context, canonical, [], {
        signal,
        verb: "getcompatpath",
        captureOutput: true,
        timeoutMs: EPIC_LINUX_PATH_TIMEOUT_MS,
      })
    ).stdout,
    true
  );
  const roundtrip = parseEpicLinuxMappedPath(
    (
      await runTool(context, mapped, [], {
        signal,
        verb: "getnativepath",
        captureOutput: true,
        timeoutMs: EPIC_LINUX_PATH_TIMEOUT_MS,
      })
    ).stdout,
    false
  );
  const back = await fs
    .realpath(roundtrip)
    .catch(() =>
      path.join(path.resolve(path.dirname(roundtrip)), path.basename(roundtrip))
    );
  if (path.relative(canonical, back) !== "")
    throw new EpicManagedError("invalid-path");
  return mapped;
}

export async function ensureEpicLinuxPrerequisites(input: {
  game: Game;
  target: EpicManagedTarget;
  installed: EpicInstalledGame;
  signal: AbortSignal;
  offline?: boolean;
  onStatus?: UmuStatusListener;
}): Promise<PreparedEpicLinuxContext> {
  const prefix = await resolveEpicLinuxPrefixPath(
    input.game,
    input.target.owner,
    input.target.artifactId
  );
  return withEpicLinuxPrefixMutation(
    prefix,
    async () => {
      const context = await prepareUnlocked(
        input.game,
        input.target,
        prefix,
        { ...input, installPath: input.installed.installPath },
        input.installed.version
      );
      const info = input.installed.prereq_info;
      if (!info) return context;
      if (typeof info.path !== "string" || typeof info.args !== "string")
        throw new EpicManagedError("prerequisites-required");
      const executable = await resolveEpicWindowsPath(
        input.installed.installPath,
        info.path
      );
      if (!executable || !/\.(?:exe|msi)$/i.test(executable))
        throw new EpicManagedError("prerequisites-required");
      const args = stringArgv(info.args);
      const fingerprint = epicLinuxPrerequisiteIdentity(
        input.installed.version,
        await fileHash(executable, input.signal),
        args,
        context.prefixGeneration,
        context.protonFingerprint
      );
      const receipt = await loadReceipt(input.target);
      if (receipt?.prerequisite === fingerprint) return context;
      if (input.offline) throw new EpicManagedError("prerequisites-required");
      const helper = prerequisiteHelperPath();
      if (!(await fs.stat(helper).catch(() => null))?.isFile())
        throw new EpicManagedError("compatibility-runtime-unavailable");
      const directory = await fs.mkdtemp(
        path.join(prefix, ".hydra-prerequisite-")
      );
      const requestFile = path.join(directory, "request.json"),
        resultFile = path.join(directory, "result.json");
      let preserveDirectory = false;
      try {
        // Each UMU mapping touches the same prefix/runtime. Keep these operations
        // ordered instead of launching four concurrent Wine/container sessions.
        const windowsExecutable = await mapEpicLinuxPath(
          context,
          executable,
          input.signal
        );
        const cwd = await mapEpicLinuxPath(
          context,
          path.dirname(executable),
          input.signal
        );
        const resultPath = await mapEpicLinuxPath(
          context,
          resultFile,
          input.signal
        );
        const requestPath = await mapEpicLinuxPath(
          context,
          requestFile,
          input.signal
        );
        const executeRequest = async (
          kind: "exe" | "msi" | "reboot",
          executable: string,
          args: string[]
        ) => {
          const nonce = randomUUID();
          await fs.rm(resultFile, { force: true });
          await writePrivateJson(requestFile, {
            schemaVersion: 1,
            kind,
            executable,
            args,
            cwd,
            nonce,
            resultPath,
          });
          await runTool(context, helper, [requestPath], {
            ...input,
            captureOutput: false,
            timeoutMs: EPIC_PREREQUISITE_TIMEOUT_MS,
          });
          try {
            return parseEpicPrerequisiteResult(
              await privateJson(resultFile),
              nonce
            );
          } catch {
            throw new EpicManagedError("prerequisites-required");
          }
        };
        const exitCode = await executeRequest(
          /\.msi$/i.test(executable) ? "msi" : "exe",
          windowsExecutable,
          args
        );
        if (![0, 3010, 1641].includes(exitCode))
          throw new EpicManagedError("prerequisites-required");
        if (exitCode !== 0 && (await executeRequest("reboot", "", [])) !== 0)
          throw new EpicManagedError("prerequisites-required");
        assertSignal(input.signal);
        if (await hasLinuxPrefixProcesses(prefix))
          throw new EpicManagedError("compatibility-prefix-busy");
        if (
          !Wine.isPrefixReadyForRestore(prefix) ||
          (await getEpicLinuxPrefixGeneration(prefix)) !==
            context.prefixGeneration ||
          (await protonFingerprint(context.protonPath)) !==
            context.protonFingerprint
        )
          throw new EpicManagedError("compatibility-runtime-unavailable");
        await writePrivateJson(receiptPath(input.target), {
          ...receipt,
          schemaVersion: EPIC_LINUX_RECEIPT_SCHEMA,
          umuVersion: context.umuVersion,
          umuFingerprint: context.umuFingerprint,
          artifactId: input.target.artifactId,
          platform: input.target.platform,
          buildVersion: input.installed.version,
          installPath: context.installPath,
          winePrefixPath: prefix,
          prefixGeneration: context.prefixGeneration,
          protonPath: context.protonPath,
          protonFingerprint: context.protonFingerprint,
          prerequisite: fingerprint,
        });
        return context;
      } catch (error) {
        preserveDirectory =
          (error as { code?: string }).code === "cleanup-failed";
        throw error;
      } finally {
        if (!preserveDirectory)
          await fs.rm(directory, { recursive: true, force: true });
      }
    },
    undefined,
    input.signal
  );
}

export async function launchEpicLinuxGame(
  parameters: EpicLaunchParameters,
  context: PreparedEpicLinuxContext,
  options: {
    launchOptions?: string | null;
    useGamemode?: boolean;
    useMangohud?: boolean;
    signal?: AbortSignal;
    onStatus?: UmuStatusListener;
    wasGameDetected?: () => boolean;
    onSpawn?: (handle: UmuProcessHandle) => void;
    lease?: EpicLinuxPrefixLease;
  } = {}
): Promise<UmuProcessHandle> {
  assertSignal(options.signal);
  const lease =
    options.lease ??
    (await acquireEpicLinuxPrefixSession(context, options.signal));
  if (activePrefixes.get(context.winePrefixPath) !== lease.id)
    throw new EpicManagedError("compatibility-prefix-busy");
  let handle: UmuProcessHandle | undefined;
  try {
    if (
      (await protonFingerprint(context.protonPath)) !==
        context.protonFingerprint ||
      (await prefixGeneration(context.winePrefixPath)) !==
        context.prefixGeneration
    )
      throw new EpicManagedError("compatibility-runtime-unavailable");
    const resolved = resolveLaunchCommand({
      baseCommand: context.pythonRunnerPath,
      baseArgs: [
        context.umuBinaryPath,
        parameters.executable,
        ...parameters.args,
      ],
      launchOptions: options.launchOptions,
      wrapperCommands: options.useGamemode ? ["gamemoderun"] : [],
    });
    if (
      parseLaunchOptions(options.launchOptions).some((argument) =>
        /^-+(?:auth_|epic(?:app|env|userid|username|sandboxid|ovt|locale))(?:[^=]*=|$)/i.test(
          argument
        )
      )
    )
      throw new EpicManagedError("invalid-operation");
    assertSignal(options.signal);
    if (activePrefixes.get(context.winePrefixPath) !== lease.id)
      throw new EpicManagedError("compatibility-prefix-busy");
    handle = await Umu.launchSupervised({
      executable: resolved.command,
      args: resolved.args,
      cwd: parameters.workingDirectory,
      environment: {
        ...process.env,
        ...parameters.environment,
        ...resolved.env,
        ...runtimeEnvironment(context),
        ...(options.useMangohud ? { MANGOHUD: "1" } : {}),
      },
      signal: options.signal,
    });
    // Startup observation may reject; publish ownership as soon as spawn succeeds.
    options.onSpawn?.(handle);
    // Keep the lease beyond wrapper exit until the token's whole tree is gone.
    if (!options.lease) {
      const launched = handle;
      void launched.exited
        .then(async () => {
          await launched.waitForTreeExit();
          while (await hasLinuxPrefixProcesses(context.winePrefixPath))
            await new Promise<void>((done) => {
              const timer = setTimeout(done, EPIC_LINUX_PATH_TIMEOUT_MS);
              timer.unref();
            });
        })
        .then(lease.release)
        .catch(() => undefined);
    }
    await observeEpicLinuxLaunch(handle, {
      signal: options.signal,
      onStatus: options.onStatus,
      wasGameDetected: options.wasGameDetected,
      hasGameProcesses: () => hasLinuxPrefixProcesses(context.winePrefixPath),
    });
    return handle;
  } catch (error) {
    // Abort listeners request termination; this boundary must await its proof.
    // The captured handle remains available to the caller if termination fails.
    if (handle) {
      try {
        await handle.terminate();
      } catch {
        throw new EpicManagedError("cleanup-failed");
      }
    }
    if (!options.lease) lease.release();
    if (
      ["operation-cancelled", "cleanup-failed"].includes(
        (error as { code?: string }).code ?? ""
      )
    )
      throw error;
    throw new EpicManagedError("compatibility-launch-failed");
  }
}

/** Caller holds the prefix session lease until this entire tool tree exits. */
export async function openEpicLinuxWinetricks(
  context: PreparedEpicLinuxContext
): Promise<UmuProcessHandle> {
  if (!activePrefixes.has(context.winePrefixPath))
    throw new EpicManagedError("compatibility-prefix-busy");
  if (
    (await getEpicLinuxPrefixGeneration(context.winePrefixPath)) !==
      context.prefixGeneration ||
    (await protonFingerprint(context.protonPath)) !== context.protonFingerprint
  )
    throw new EpicManagedError("compatibility-runtime-unavailable");
  return Umu.launchSupervised({
    executable: context.pythonRunnerPath,
    args: [context.umuBinaryPath, "winetricks", "--gui"],
    cwd: context.winePrefixPath,
    environment: { ...process.env, ...runtimeEnvironment(context) },
  });
}
