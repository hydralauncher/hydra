import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { build } from "esbuild";

it(
  "initializes every PS3 game with at most four concurrent startup reads",
  { timeout: 10000 },
  async (t) => {
    const id = `rpcs3startup${randomUUID().replaceAll("-", "")}`;
    const globals = globalThis as unknown as Record<string, unknown>;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstReads = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const state = {
      games: Array.from({ length: 9 }, (_, index) => ({
        shop: "launchbox",
        objectId: String(index),
        platform: "Sony Playstation 3",
        title: "Fixture",
      })),
      gate,
      entered,
      active: 0,
      maximum: 0,
      reads: 0,
    };
    globals[id] = state;
    const cache = path.resolve("node_modules/.cache/rpcs3-tests");
    await fs.mkdir(cache, { recursive: true });
    const bundle = path.join(cache, `${id}.mjs`);
    const stubs: Record<string, string> = {
      "@main/level": `export const db={get:async()=>null}; export const gamesSublevel={get:async key=>s.games.find(game=>key==='launchbox:'+game.objectId),values:()=>({all:async()=>s.games})}; export const levelKeys={game:(shop,id)=>shop+':'+id};`,
      "emulators-repository": `export const getEmulatorConfig=async()=>{s.reads++;s.active++;s.maximum=Math.max(s.maximum,s.active);if(s.active===4)s.entered();await s.gate;s.active--;return {executablePath:'fixture'}};`,
      "rpcs3-config-root": `export const resolveRpcs3ConfigRootStatus=async()=>({location:null});`,
      "window-manager": `export const WindowManager={sendToAppWindows:()=>{}};`,
      logger: `export const achievementsLogger={warn:()=>{}};`,
      "achievement-memory-store": `export const AchievementMemoryStore={set:()=>{},delete:()=>{}};`,
      "unlocked-achievements-cache": `export const UnlockedAchievementsCache={invalidate:()=>{}};`,
      "achievement-unlock-notifications": `export const publishAchievementUnlockNotifications=()=>{};`,
      "trophy-discovery": `export const findGameTrophySetIds=async()=>[],getGameTrophyMediaPaths=()=>[],resolveTrophyUser=async()=>null;`,
      "trophy-data": `export const readTrophySet=async()=>[];`,
    };
    await build({
      entryPoints: [
        path.resolve(
          "src/main/services/achievements/rpcs3/rpcs3-achievements.ts"
        ),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      plugins: [
        {
          name: "startup-fixture",
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
              const key = Object.keys(stubs).find(
                (key) =>
                  args.path === key ||
                  args.path.replace(/\.js$/, "").endsWith("/" + key)
              );
              return key ? { path: key, namespace: "fixture" } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
              contents:
                `const s=globalThis[${JSON.stringify(id)}];` + stubs[args.path],
            }));
          },
        },
      ],
    });
    const provider = await import(pathToFileURL(bundle).href);
    t.after(async () => {
      release();
      provider.stopRpcs3TrophyWatchers();
      delete globals[id];
      await fs.unlink(bundle);
    });
    const initialized = provider.initializeRpcs3Trophies();
    await firstReads;
    assert.equal(state.reads, 4);
    assert.equal(state.maximum, 4);
    release();
    await initialized;
    assert.equal(state.reads, 9);
    assert.equal(state.maximum, 4);
    assert.equal(state.active, 0);
  }
);
