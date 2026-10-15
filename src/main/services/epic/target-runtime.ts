import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { EpicAuthContext } from "./integration-core";
import type { EpicConnectedConnection } from "../../../types/epic-integration.types";
import type { EpicSessionBundle } from "./store";
import type { EpicSessionProvider } from "./session-provider";
import {
  isRecord,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.js";
import { isEpicObjectId } from "./library-normalizer.js";
import { queueEpicOperation } from "./operation-queue.js";
import {
  EPIC_SYNC_MAX_OUTPUT_BYTES,
  EPIC_SYNC_TIMEOUT_MS,
  EPIC_TARGET_AUTH_ATTEMPTS,
} from "./constants.js";
import {
  EpicManagedError,
  type EpicManagedTarget,
  type executeManagedLegendary,
} from "./legendary-managed-runtime.js";
import { withEpicTiming } from "./timing.js";

export interface EpicManagedCommand {
  binary: string;
  prefixArgs: string[];
}
export interface EpicTargetInspection {
  info: unknown;
  metadata: Record<string, unknown>;
  manifest?: unknown;
}
interface TargetRuntimeOptions {
  userData: string;
  command: () => Promise<EpicManagedCommand>;
  session: Pick<EpicSessionProvider, "useBundle"> &
    Partial<Pick<EpicSessionProvider, "accessSnapshot">>;
  execute: typeof executeManagedLegendary;
  supervisorDirectory?: string;
  current: (target: EpicManagedTarget) => boolean;
  workspace: (target: EpicManagedTarget) => string;
  serialize: <T>(
    target: EpicManagedTarget,
    task: (directory: string) => Promise<T>,
    signal?: AbortSignal
  ) => Promise<T>;
  active: Map<AbortController, Promise<unknown>>;
}
const contained = (root: string, file: string) => {
  if (!path.isAbsolute(file)) return false;
  const relative = path.relative(
    path.toNamespacedPath(path.resolve(root)),
    path.toNamespacedPath(file)
  );
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export class EpicTargetRuntime {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly options: TargetRuntimeOptions) {}
  private assert(target: EpicManagedTarget, signal: AbortSignal) {
    if (signal.aborted || !this.options.current(target))
      throw new EpicManagedError("operation-cancelled");
  }
  private directory(target: EpicManagedTarget) {
    const scope = createHash("sha256")
      .update(
        JSON.stringify([
          target.owner,
          target.auth.generation,
          target.connection.connectionId,
        ])
      )
      .digest("hex");
    const artifact = createHash("sha256")
      .update(JSON.stringify([target.artifactId, target.platform]))
      .digest("hex");
    return path.join(
      this.options.userData,
      "epic-managed-previews",
      scope,
      artifact
    );
  }
  private async prepare(directory: string) {
    const root = path.join(this.options.userData, "epic-managed-previews");
    for (const item of [root, path.dirname(directory), directory]) {
      await fs.mkdir(item, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(item);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new EpicManagedError("invalid-path");
      await fs.chmod(item, 0o700);
    }
    const config = path.join(directory, "config.ini");
    const previous = await fs
      .lstat(config)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (previous && (!previous.isFile() || previous.isSymbolicLink()))
      throw new EpicManagedError("invalid-path");
    await fs.rm(config, { force: true });
    await fs.writeFile(
      config,
      "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\ndisable_auto_aliasing = true\n",
      { mode: 0o600, flag: "wx" }
    );
  }
  private target(target: EpicManagedTarget, objectId: string) {
    if (
      !isEpicObjectId(objectId) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(target.artifactId)
    )
      throw new EpicManagedError("invalid-artifact");
    const [namespace, catalogItemId] = objectId.split(":");
    return {
      namespace,
      catalogItemId,
      artifactId: target.artifactId,
      platform: target.platform,
    };
  }
  private async privateJson(file: string, value: unknown) {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > EPIC_SYNC_MAX_OUTPUT_BYTES)
      throw new EpicManagedError("invalid-response");
    await fs.rm(file, { force: true });
    await fs.writeFile(file, data, { mode: 0o600, flag: "wx" });
  }
  private async cleanup(directory: string) {
    const results = await Promise.allSettled(
      ["user.json", "version.json", "managed-request.json"].map((name) =>
        fs.rm(path.join(directory, name), { force: true })
      )
    );
    if (results.some((result) => result.status === "rejected"))
      throw new EpicManagedError("cleanup-failed");
  }
  private async invoke(
    directory: string,
    request: unknown,
    signal: AbortSignal,
    onLine?: (line: string) => void
  ) {
    if (signal.aborted) throw new EpicManagedError("operation-cancelled");
    await this.privateJson(path.join(directory, "managed-request.json"), {
      protocolVersion: 1,
      ...(request as object),
    });
    const command = await this.options.command();
    if (signal.aborted) throw new EpicManagedError("operation-cancelled");
    return this.options.execute(
      command.binary,
      [
        ...command.prefixArgs,
        "--request",
        path.join(directory, "managed-request.json"),
      ],
      directory,
      {
        signal,
        timeout: onLine ? undefined : EPIC_SYNC_TIMEOUT_MS,
        supervisorDirectory: this.options.supervisorDirectory,
        ...(onLine ? { streaming: true, onLine } : {}),
      }
    );
  }
  async inspect(
    target: EpicManagedTarget,
    objectId: string,
    signal: AbortSignal,
    cached?: { manifest?: unknown }
  ): Promise<EpicTargetInspection> {
    const directory = this.directory(target);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const { queued, result } = queueEpicOperation(
      this.queues.get(directory),
      async () => {
        this.assert(target, controller.signal);
        await this.prepare(directory);
        this.assert(target, controller.signal);
        if (!this.options.session.accessSnapshot)
          throw new EpicManagedError("legendary-unavailable");
        try {
          for (
            let attempt = 0;
            attempt < EPIC_TARGET_AUTH_ATTEMPTS;
            attempt++
          ) {
            const access = await this.options.session.accessSnapshot(
              target.auth,
              target.connection,
              controller.signal,
              attempt > 0
            );
            this.assert(target, controller.signal);
            await this.privateJson(path.join(directory, "user.json"), access);
            this.assert(target, controller.signal);
            try {
              const response = await withEpicTiming(
                "runtime.inspect-target",
                () =>
                  this.invoke(
                    directory,
                    {
                      operation: "inspect",
                      target: this.target(target, objectId),
                      ...(cached?.manifest ? { receipt: cached.manifest } : {}),
                    },
                    controller.signal
                  )
              );
              this.assert(target, controller.signal);
              const value: unknown = JSON.parse(response.stdout);
              if (
                !isRecord(value) ||
                value.protocolVersion !== 1 ||
                !isRecord(value.metadata) ||
                !isRecord(value.receipt)
              )
                throw new EpicManagedError("invalid-response");
              const identity = this.target(target, objectId);
              const metadata = value.metadata.metadata;
              const assets = value.metadata.asset_infos;
              const asset = isRecord(assets)
                ? assets[target.platform]
                : undefined;
              if (
                value.metadata.app_name !== identity.artifactId ||
                !isRecord(metadata) ||
                metadata.namespace !== identity.namespace ||
                metadata.id !== identity.catalogItemId ||
                !isRecord(asset) ||
                asset.app_name !== identity.artifactId ||
                asset.namespace !== identity.namespace ||
                asset.catalog_item_id !== identity.catalogItemId ||
                !isRecord(value.info) ||
                !isRecord(value.info.game) ||
                value.info.game.app_name !== identity.artifactId ||
                value.info.game.version !== value.receipt.version
              )
                throw new EpicManagedError("invalid-artifact");
              await this.validateReceipt(directory, value.receipt, identity);
              this.assert(target, controller.signal);
              return {
                info: value.info,
                metadata: value.metadata,
                manifest: value.receipt,
              };
            } catch (error) {
              if (
                attempt === 0 &&
                error instanceof EpicManagedError &&
                error.code === "session-expired"
              )
                continue;
              throw error;
            }
          }
          throw new EpicManagedError("session-expired");
        } finally {
          await this.cleanup(directory);
        }
      },
      controller.signal,
      { queue: "workspace" }
    );
    this.queues.set(directory, queued);
    // Register before the queue or filesystem preparation can yield to stop().
    this.options.active.set(controller, queued);
    void queued
      .finally(() => {
        if (this.queues.get(directory) === queued)
          this.queues.delete(directory);
        signal.removeEventListener("abort", abort);
        this.options.active.delete(controller);
      })
      .catch(() => undefined);
    return result;
  }
  private async validateReceipt(
    directory: string,
    receipt: Record<string, unknown>,
    identity: ReturnType<EpicTargetRuntime["target"]>
  ) {
    if (
      typeof receipt.manifestPath !== "string" ||
      !contained(directory, receipt.manifestPath) ||
      typeof receipt.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      typeof receipt.sourceHash !== "string" ||
      !/^[a-f0-9]{40}$/.test(receipt.sourceHash) ||
      typeof receipt.version !== "string" ||
      !receipt.version
    )
      throw new EpicManagedError("invalid-response");
    const canonicalDirectory = await fs.realpath(directory);
    for (const file of [receipt.manifestPath, `${receipt.manifestPath}.json`]) {
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > EPIC_SYNC_MAX_OUTPUT_BYTES ||
        !contained(canonicalDirectory, await fs.realpath(file))
      )
        throw new EpicManagedError("invalid-response");
    }
    const state: unknown = JSON.parse(
      await fs.readFile(`${receipt.manifestPath}.json`, "utf8")
    );
    if (
      !isRecord(state) ||
      !isRecord(state.target) ||
      !Object.entries(identity).every(
        ([key, value]) =>
          (state.target as Record<string, unknown>)[key] === value
      ) ||
      state.sourceHash !== receipt.sourceHash ||
      state.version !== receipt.version
    )
      throw new EpicManagedError("invalid-artifact");
    const contents = await fs.readFile(receipt.manifestPath);
    // The pinned adapter verifies Epic's protocol SHA-1 against the authenticated
    // descriptor. Protect the private cached bytes here with SHA-256; sourceHash
    // remains bound to the target/version sidecar above and is rechecked against
    // the current descriptor before installation.
    if (createHash("sha256").update(contents).digest("hex") !== receipt.sha256)
      throw new EpicManagedError("invalid-response");
  }
  async streamInstall(
    target: EpicManagedTarget,
    objectId: string,
    prepared: { manifest?: unknown },
    args: string[],
    options: { signal: AbortSignal; onLine: (line: string) => void }
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    const operation = this.options.serialize(
      target,
      async (directory) => {
        this.assert(target, controller.signal);
        let receipt: unknown;
        if (isRecord(prepared.manifest)) {
          await this.validateReceipt(
            this.directory(target),
            prepared.manifest,
            this.target(target, objectId)
          );
          this.assert(target, controller.signal);
          const from = prepared.manifest.manifestPath as string;
          const manifests = path.join(directory, "managed-manifests");
          await fs.mkdir(manifests, { recursive: true, mode: 0o700 });
          const manifestDirectory = await fs.lstat(manifests);
          if (
            !manifestDirectory.isDirectory() ||
            manifestDirectory.isSymbolicLink()
          )
            throw new EpicManagedError("invalid-path");
          const destination = path.join(
            manifests,
            `${prepared.manifest.sha256}.manifest`
          );
          this.assert(target, controller.signal);
          await fs.rm(destination, { force: true });
          await fs.rm(`${destination}.json`, { force: true });
          await fs.copyFile(from, destination);
          await fs.copyFile(`${from}.json`, `${destination}.json`);
          receipt = { ...prepared.manifest, manifestPath: destination };
        }
        try {
          for (
            let attempt = 0;
            attempt < EPIC_TARGET_AUTH_ATTEMPTS;
            attempt++
          ) {
            this.assert(target, controller.signal);
            // Refresh outside useBundle: refreshing inside the same credential
            // lease would deadlock behind itself.
            if (this.options.session.accessSnapshot)
              await this.options.session.accessSnapshot(
                target.auth,
                target.connection,
                controller.signal,
                attempt > 0
              );
            this.assert(target, controller.signal);
            let processOperation: Promise<unknown> | undefined;
            let preparedTransfer = false;
            try {
              await this.options.session.useBundle(
                target.auth,
                target.connection,
                controller.signal,
                async (bundle, save) => {
                  let credentialsWritten = false;
                  let ready!: () => void;
                  const boundary = new Promise<void>((done) => {
                    ready = done;
                  });
                  try {
                    this.assert(target, controller.signal);
                    if (
                      Date.parse(bundle.user.expires_at as string) <= Date.now()
                    )
                      throw new EpicManagedError("session-expired");
                    await this.privateJson(
                      path.join(directory, "user.json"),
                      validateLegendarySession(bundle.user)
                    );
                    await this.privateJson(
                      path.join(directory, "version.json"),
                      validateLegendaryVersion(bundle.version)
                    );
                    credentialsWritten = true;
                    this.assert(target, controller.signal);
                    processOperation = this.invoke(
                      directory,
                      {
                        operation: "install",
                        target: this.target(target, objectId),
                        args,
                        ...(receipt ? { receipt } : {}),
                      },
                      controller.signal,
                      (line) => {
                        if (
                          !preparedTransfer &&
                          /\bDownload size(?::| is 0\b)/.test(line)
                        ) {
                          preparedTransfer = true;
                          ready();
                        }
                        options.onLine(line);
                      }
                    );
                    await Promise.race([boundary, processOperation]);
                    await this.save(directory, target, save);
                  } catch (error) {
                    const retryAuthentication =
                      !preparedTransfer &&
                      error instanceof EpicManagedError &&
                      error.code === "session-expired";
                    if (!retryAuthentication) controller.abort();
                    await processOperation?.catch(() => undefined);
                    if (credentialsWritten)
                      await this.save(directory, target, save);
                    throw error;
                  } finally {
                    await this.cleanup(directory);
                  }
                }
              );
              await processOperation;
              this.assert(target, controller.signal);
              return;
            } catch (error) {
              if (
                attempt === 0 &&
                !preparedTransfer &&
                !controller.signal.aborted &&
                this.options.current(target) &&
                error instanceof EpicManagedError &&
                error.code === "session-expired" &&
                this.options.session.accessSnapshot
              )
                continue;
              throw error;
            }
          }
        } finally {
          await this.cleanup(directory);
        }
      },
      controller.signal
    );
    this.options.active.set(controller, operation);
    try {
      await operation;
    } finally {
      options.signal.removeEventListener("abort", abort);
      this.options.active.delete(controller);
    }
  }
  private async save(
    directory: string,
    target: EpicManagedTarget,
    save: (bundle: EpicSessionBundle) => Promise<void>
  ) {
    const read = async (name: string): Promise<unknown> => {
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > EPIC_SYNC_MAX_OUTPUT_BYTES
      )
        throw new EpicManagedError("invalid-response");
      return JSON.parse(await fs.readFile(file, "utf8"));
    };
    const user = validateLegendarySession(await read("user.json"));
    const version = validateLegendaryVersion(await read("version.json"));
    if (String(user.account_id).toLowerCase() !== target.owner.epicAccountId)
      throw new EpicManagedError("different-account");
    if (Date.parse(user.expires_at as string) > Date.now())
      await save({ user, version });
  }
  async refresh(
    auth: EpicAuthContext,
    connection: EpicConnectedConnection,
    bundle: EpicSessionBundle,
    signal: AbortSignal
  ): Promise<EpicSessionBundle> {
    const target: EpicManagedTarget = {
      auth,
      connection,
      owner: {
        environment: auth.environment,
        userId: auth.userId,
        epicAccountId: connection.epicAccountId,
      },
      artifactId: "session-refresh",
      platform: "Windows",
    };
    const directory = this.directory(target);
    this.assert(target, signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const operation = (async () => {
      await this.prepare(directory);
      this.assert(target, controller.signal);
      try {
        await this.privateJson(
          path.join(directory, "user.json"),
          validateLegendarySession(bundle.user)
        );
        await this.privateJson(
          path.join(directory, "version.json"),
          validateLegendaryVersion(bundle.version)
        );
        let failure: unknown;
        try {
          const response = await this.invoke(
            directory,
            { operation: "refresh" },
            controller.signal
          );
          const value: unknown = JSON.parse(response.stdout);
          if (!isRecord(value) || value.protocolVersion !== 1)
            throw new EpicManagedError("invalid-response");
        } catch (error) {
          failure = error;
        }
        // Preserve OAuth rotation completed before the last consumer cancelled.
        if (!this.options.current(target))
          throw new EpicManagedError("operation-cancelled");
        let rotated: EpicSessionBundle | undefined;
        await this.save(directory, target, async (value) => {
          rotated = value;
        });
        if (
          failure &&
          !(
            failure instanceof EpicManagedError &&
            failure.code === "operation-cancelled"
          )
        )
          throw failure;
        if (!rotated) {
          if (failure) throw failure;
          throw new EpicManagedError("session-expired");
        }
        return rotated;
      } finally {
        await this.cleanup(directory);
      }
    })();
    this.options.active.set(controller, operation);
    try {
      return await operation;
    } finally {
      signal.removeEventListener("abort", abort);
      this.options.active.delete(controller);
    }
  }
}
