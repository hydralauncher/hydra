import fs from "node:fs/promises";
import path from "node:path";
import {
  EpicIntegrationError,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.js";
import {
  executeLegendaryCommand,
  LegendaryProcessCleanupError,
  EPIC_SESSION_MAX_FILE_BYTES,
  EPIC_LEGENDARY_API_TIMEOUT_SECONDS,
} from "./legendary-auth.js";
import {
  EPIC_SYNC_MAX_OUTPUT_BYTES,
  EPIC_SYNC_TIMEOUT_MS,
} from "./constants.js";
import type { EpicSessionBundle } from "./store";

export class LegendarySyncRunner {
  private pendingTermination?: () => Promise<void>;
  private constructor(
    private readonly binary: string,
    private readonly directory: string,
    private readonly accountId: string,
    private readonly signal: AbortSignal,
    private readonly onSession: (bundle: EpicSessionBundle) => Promise<void>
  ) {}

  static async create(
    binary: string,
    userData: string,
    accountId: string,
    bundle: EpicSessionBundle,
    signal: AbortSignal,
    onSession: (bundle: EpicSessionBundle) => Promise<void>
  ) {
    if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
    const user = validateLegendarySession(bundle.user);
    const version = validateLegendaryVersion(bundle.version);
    if (String(user.account_id).toLowerCase() !== accountId)
      throw new EpicIntegrationError("different-account");
    const root = path.join(userData, "epic-temporary");
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await fs.mkdtemp(path.join(root, "operation-"));
    try {
      await fs.chmod(directory, 0o700);
      for (const [name, value] of [
        ["user.json", user],
        ["version.json", version],
      ] as const) {
        const contents = JSON.stringify(value);
        if (Buffer.byteLength(contents) > EPIC_SESSION_MAX_FILE_BYTES)
          throw new EpicIntegrationError("invalid-response");
        await fs.writeFile(path.join(directory, name), contents, {
          mode: 0o600,
        });
      }
      await fs.writeFile(
        path.join(directory, "config.ini"),
        "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\ndisable_auto_aliasing = true\n",
        { mode: 0o600 }
      );
      return new LegendarySyncRunner(
        binary,
        directory,
        accountId,
        signal,
        onSession
      );
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async readJson(name: string): Promise<unknown> {
    const file = path.join(this.directory, name);
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > EPIC_SESSION_MAX_FILE_BYTES
    )
      throw new EpicIntegrationError("invalid-response");
    await fs.chmod(file, 0o600);
    return JSON.parse(await fs.readFile(file, "utf8"));
  }

  private async saveRotatedSession() {
    const user = validateLegendarySession(await this.readJson("user.json"));
    const version = validateLegendaryVersion(
      await this.readJson("version.json")
    );
    if (String(user.account_id).toLowerCase() !== this.accountId)
      throw new EpicIntegrationError("different-account");
    // A synthetic expiration used to force refresh is never persisted.
    if (
      Date.parse(user.expires_at as string) <= Date.now() ||
      Date.parse(user.refresh_expires_at as string) <= Date.now()
    )
      return;
    await this.onSession({ user, version });
  }

  private async run(args: string[]) {
    let output: string | undefined;
    let failure: unknown;
    try {
      output = await executeLegendaryCommand(
        this.binary,
        ["--api-timeout", String(EPIC_LEGENDARY_API_TIMEOUT_SECONDS), ...args],
        {
          encoding: "utf8",
          signal: this.signal,
          timeout: EPIC_SYNC_TIMEOUT_MS,
          maxBuffer: EPIC_SYNC_MAX_OUTPUT_BYTES,
          sessionRequired: true,
          env: { ...process.env, LEGENDARY_CONFIG_PATH: this.directory },
        }
      );
    } catch (error) {
      if (error instanceof LegendaryProcessCleanupError) {
        this.pendingTermination = error.retry;
        throw error;
      }
      failure = error;
    }
    // Legendary deletes invalid credentials, so reading them would mask reconnection.
    if (
      failure instanceof EpicIntegrationError &&
      failure.code === "session-expired"
    )
      throw failure;
    // The process tree is stopped before reading; cancellation does not discard a rotated refresh token.
    await this.saveRotatedSession();
    if (failure) throw failure;
    if (this.signal.aborted)
      throw new EpicIntegrationError("operation-cancelled");
    try {
      return JSON.parse(output!) as unknown;
    } catch {
      throw new EpicIntegrationError("invalid-response");
    }
  }

  async library(): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const platform of ["Windows", "Mac"]) {
      const result = await this.run([
        "list",
        "--json",
        "--include-non-installable",
        "--platform",
        platform,
      ]);
      if (!Array.isArray(result))
        throw new EpicIntegrationError("invalid-response");
      results.push(result);
    }
    return results;
  }

  async refresh(force: boolean) {
    if (force) {
      const user = validateLegendarySession(await this.readJson("user.json"));
      await fs.writeFile(
        path.join(this.directory, "user.json"),
        JSON.stringify({ ...user, expires_at: new Date(0).toISOString() }),
        { mode: 0o600 }
      );
    }
    await this.run(["status", "--json"]);
  }

  async cleanup() {
    await this.pendingTermination?.();
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
