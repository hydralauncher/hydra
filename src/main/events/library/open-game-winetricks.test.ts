import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function fixture(managed: boolean, open: (id: string) => Promise<boolean>) {
  let handler!: (...args: unknown[]) => Promise<boolean>;
  let legacyLookups = 0;
  const spawns: { binary: string; options: { env: Record<string, string> } }[] =
    [];
  const modules: Record<string, unknown> = {
    "../register-event": {
      registerEvent: (_name: string, callback: typeof handler) => {
        handler = callback;
      },
    },
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesSublevel: {
        get: async () => ({
          winePrefixPath: "/custom/prefix",
          ...(managed ? { epicInstallation: {} } : {}),
        }),
      },
    },
    "@main/services": {
      logger: { error: () => {} },
      Wine: {
        getEffectivePrefixPath: () => {
          legacyLookups++;
          return "/custom/prefix";
        },
      },
    },
    "@main/services/epic": { openManagedEpicWinetricks: open },
    "node:child_process": {
      spawn: (binary: string, options: { env: Record<string, string> }) => {
        spawns.push({ binary, options });
        const child = Object.assign(new EventEmitter(), { unref: () => {} });
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
  };
  const { outputText } = ts.transpileModule(
    fs.readFileSync(
      new URL("./open-game-winetricks.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ESNext,
      },
    }
  );
  new Function("exports", "require", "process", outputText)(
    {},
    (name: string) => modules[name] ?? assert.fail(name),
    { platform: "linux", env: { DISPLAY: ":0" } }
  );
  return {
    invoke: (shop: string) => handler({}, shop, "real:epic"),
    spawns,
    legacyLookups: () => legacyLookups,
  };
}

test("managed Epic Winetricks uses the guarded service with the real identity and no system Wine fallback", async () => {
  const calls: string[] = [];
  const f = fixture(true, async (id) => {
    calls.push(id);
    return true;
  });
  assert.equal(await f.invoke("epic"), true);
  assert.deepEqual(calls, ["real:epic"]);
  assert.equal(f.legacyLookups(), 0);
  assert.equal(f.spawns.length, 0);
});
test("managed runtime or prefix failure stays recoverable without launching system Winetricks", async () => {
  const f = fixture(true, async () => {
    throw new Error("compatibility-prefix-busy");
  });
  assert.equal(await f.invoke("epic"), false);
  assert.equal(f.legacyLookups(), 0);
  assert.equal(f.spawns.length, 0);
});
test("existing unmanaged games retain their Winetricks launcher and effective prefix", async () => {
  const f = fixture(false, async () =>
    assert.fail("managed service must not run")
  );
  assert.equal(await f.invoke("steam"), true);
  assert.equal(f.legacyLookups(), 1);
  assert.equal(f.spawns[0].binary, "winetricks");
  assert.equal(f.spawns[0].options.env.WINEPREFIX, "/custom/prefix");
});
