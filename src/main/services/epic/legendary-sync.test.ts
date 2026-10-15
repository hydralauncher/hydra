import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { test, type TestContext } from "node:test";
import * as protocol from "./auth-protocol.js";
import * as constants from "./constants.js";
import { bundle, connection } from "./store-test-helpers.js";
import type { EpicSessionBundle } from "./store";
import {
  LegendaryProcessCleanupError,
  EPIC_SESSION_MAX_FILE_BYTES,
  EPIC_LEGENDARY_API_TIMEOUT_SECONDS,
} from "./legendary-auth.js";

type Command = (directory: string, args: string[]) => Promise<string>;
async function fixture(t: TestContext, command: Command) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-sync-runner-"));
  const controller = new AbortController();
  const sessions: EpicSessionBundle[] = [];
  const source = await fs.readFile(
    new URL("./legendary-sync.ts", import.meta.url),
    "utf8"
  );
  const modules: Record<string, unknown> = {
    "node:fs/promises": fs,
    "node:path": path,
    "./auth-protocol.js": protocol,
    "./constants.js": constants,
    "./legendary-auth.js": {
      LegendaryProcessCleanupError,
      EPIC_SESSION_MAX_FILE_BYTES,
      EPIC_LEGENDARY_API_TIMEOUT_SECONDS,
      executeLegendaryCommand: async (
        _binary: string,
        args: string[],
        options: { env: { LEGENDARY_CONFIG_PATH: string }; maxBuffer: number }
      ) => {
        assert.equal(options.maxBuffer, constants.EPIC_SYNC_MAX_OUTPUT_BYTES);
        assert.ok(options.env.LEGENDARY_CONFIG_PATH.startsWith(root));
        assert.ok(!args.includes("auth"));
        return command(options.env.LEGENDARY_CONFIG_PATH, args);
      },
    },
  };
  const module = {} as typeof import("./legendary-sync");
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: module,
      require: (id: string) =>
        modules[id] ?? assert.fail(`Unexpected dependency ${id}`),
      process,
      Buffer,
      Date,
    }
  );
  const runner = await module.LegendarySyncRunner.create(
    "controlled-binary",
    root,
    connection.epicAccountId,
    bundle,
    controller.signal,
    async (session) => {
      sessions.push(session);
    }
  );
  t.after(async () => {
    await runner.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, controller, runner, sessions };
}
test("sync executes Windows/Mac independently and accepts confirmed empty arrays", async (t) => {
  const args: string[][] = [];
  const f = await fixture(t, async (_directory, command) => {
    args.push(command);
    return "[]\n";
  });
  assert.equal(JSON.stringify(await f.runner.library()), "[[],[]]");
  assert.equal(args[0].at(-1), "Windows");
  assert.equal(args[1].at(-1), "Mac");
  assert.ok(
    args.every(
      (command) =>
        command.includes("--include-non-installable") &&
        command.includes("--json")
    )
  );
});
test("persists real rotated credentials after a later library command fails", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (directory) => {
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({ ...bundle.user, refresh_token: "rotated-private-token" })
    );
    if (++calls === 2) throw new protocol.EpicIntegrationError("auth-failed");
    return "[]";
  });
  await assert.rejects(f.runner.library(), /auth-failed/);
  assert.equal(f.sessions.at(-1)?.user.refresh_token, "rotated-private-token");
});
test("forced refresh changes only the private temporary expiration", async (t) => {
  const original = bundle.user.expires_at;
  const f = await fixture(t, async (directory, args) => {
    assert.equal(args.at(-2), "status");
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    assert.equal(user.expires_at, new Date(0).toISOString());
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({
        ...user,
        expires_at: original,
        access_token: "renewed-private-token",
      })
    );
    return "{}";
  });
  await f.runner.refresh(true);
  assert.equal(bundle.user.expires_at, original);
  assert.equal(f.sessions.at(-1)?.user.access_token, "renewed-private-token");
});
test("a failed forced refresh never persists synthetic expiry", async (t) => {
  const f = await fixture(t, async () => {
    throw new protocol.EpicIntegrationError("auth-failed");
  });
  await assert.rejects(f.runner.refresh(true));
  assert.equal(f.sessions.length, 0);
});

test("revoked credentials request reconnection even when Legendary deletes user.json", async (t) => {
  const f = await fixture(t, async (directory) => {
    await fs.rm(path.join(directory, "user.json"));
    throw new protocol.EpicIntegrationError("session-expired");
  });
  await assert.rejects(f.runner.library(), /session-expired/);
  assert.equal(f.sessions.length, 0);
});
test("rotated token survives cancellation but no collected library is returned", async (t) => {
  const f = await fixture(t, async (directory) => {
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({ ...bundle.user, refresh_token: "rotated-private-token" })
    );
    f.controller.abort();
    throw new protocol.EpicIntegrationError("operation-cancelled");
  });
  await assert.rejects(f.runner.library(), /operation-cancelled/);
  assert.equal(f.sessions.at(-1)?.user.refresh_token, "rotated-private-token");
});
test("missing JSON is not accepted as empty library", async (t) => {
  const f = await fixture(t, async () => "");
  await assert.rejects(f.runner.library(), /invalid-response/);
});
