import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { build } from "esbuild";

it(
  "baselines existing trophies, publishes one new unlock, survives partial writes and isolates profile changes",
  { timeout: 20000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-rpcs3-provider-")
    );
    const cache = path.resolve("node_modules/.cache/rpcs3-tests");
    await fs.mkdir(cache, { recursive: true });
    const id = `rpcs3${randomUUID().replaceAll("-", "")}`;
    const bundle = path.join(cache, `${id}.mjs`);
    const globals = globalThis as unknown as Record<string, unknown>;
    const setId = "NPWR12345_00";
    const game = {
      shop: "launchbox",
      objectId: "fixture",
      platform: "Sony Playstation 3",
      selectedDiscPath: path.join(root, "media"),
      title: "Fixture",
    };
    const state = {
      game,
      notifications: [] as Array<{
        achievements: Array<{ trophyGrade: string }>;
      }>,
      updates: [] as unknown[],
      libraryRefreshes: 0,
      warnings: 0,
      warning: null as (() => void) | null,
      update: null as (() => void) | null,
    };
    globals[id] = state;
    const home = path.join(root, "home");
    const trophy = path.join(home, "00000001", "trophy", setId);
    await fs.mkdir(trophy, { recursive: true });
    await fs.mkdir(path.join(root, "media", "TROPDIR", setId), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "GuiConfigs"));
    const settings = path.join(root, "GuiConfigs", "persistent_settings.dat");
    await fs.writeFile(settings, "[Users]\nactive_user=00000001\n");
    await fs.writeFile(
      path.join(trophy, "TROPCONF.SFM"),
      `<trophyconf><npcommid>${setId}</npcommid><title-name>Fixture</title-name><trophy id="0" ttype="P"><name>Platinum</name></trophy><trophy id="1" ttype="B"><name>Bronze</name></trophy></trophyconf>`
    );
    const data = (platinum: boolean) => {
      const buffer = Buffer.alloc(80 + 224);
      buffer.writeUInt32BE(0x818f54ad, 0);
      buffer.writeUInt32BE(1, 8);
      buffer.writeUInt32BE(6, 48);
      buffer.writeUInt32BE(96, 52);
      buffer.writeUInt32BE(2, 60);
      buffer.writeBigUInt64BE(80n, 64);
      for (let i = 0; i < 2; i++) {
        const pos = 80 + i * 112;
        buffer.writeUInt32BE(6, pos);
        buffer.writeUInt32BE(96, pos + 4);
        buffer.writeUInt32BE(i, pos + 16);
        buffer.writeUInt32BE(i === 1 || platinum ? 1 : 0, pos + 20);
      }
      return buffer;
    };
    const file = path.join(trophy, "TROPUSR.DAT");
    await fs.writeFile(file, data(false));
    const prefix = `const s=globalThis[${JSON.stringify(id)}];`;
    const stubs: Record<string, string> = {
      "@main/level": `export const db={get:async()=>null}; export const gamesSublevel={get:async()=>s.game}; export const levelKeys={game:(shop,id)=>shop+':'+id};`,
      "emulators-repository": `export const getEmulatorConfig=async()=>({executablePath:'fixture',rpcs3ConfigRoot:${JSON.stringify(root)}});`,
      "rpcs3-config-root": `export const resolveRpcs3ConfigRootStatus=async()=>({location:{configRoot:${JSON.stringify(root)},homeRoot:${JSON.stringify(home)}}});`,
      "window-manager": `export const WindowManager={sendToAppWindows:()=>{s.libraryRefreshes++},mainWindow:{webContents:{send:(...args)=>{s.updates.push(args);s.update?.()}}}};`,
      logger: `export const achievementsLogger={warn:()=>{s.warnings++;s.warning?.()}};`,
      "achievement-memory-store": `export const AchievementMemoryStore={set:()=>{},delete:()=>{}};`,
      "unlocked-achievements-cache": `export const UnlockedAchievementsCache={invalidate:()=>{}};`,
      "achievement-unlock-notifications": `export const publishAchievementUnlockNotifications=(value)=>{s.notifications.push(value)};`,
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
          name: "fixture",
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
              const key = Object.keys(stubs).find(
                (key) => args.path === key || args.path.endsWith(`/${key}`)
              );
              return key ? { path: key, namespace: "fixture" } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
              contents: prefix + stubs[args.path],
              loader: "js",
            }));
          },
        },
      ],
    });
    const provider = await import(pathToFileURL(bundle).href);
    t.after(async () => {
      provider.stopRpcs3TrophyWatchers();
      delete globals[id];
      await fs.rm(root, { recursive: true, force: true });
      await fs.unlink(bundle);
    });
    const waitFor = (kind: "warning" | "update") =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`No ${kind} event`)),
          5000
        );
        state[kind] = () => {
          clearTimeout(timer);
          state[kind] = null;
          resolve();
        };
      });
    const first = await provider.getRpcs3Achievements("fixture", "launchbox");
    assert.equal(
      first.filter((row: { unlocked: boolean }) => row.unlocked).length,
      1
    );
    assert.equal(state.notifications.length, 0);
    assert.equal(state.libraryRefreshes, 1);
    const failedRead = waitFor("warning");
    await fs.writeFile(file, Buffer.alloc(12));
    await failedRead;
    const retained = await provider.getRpcs3Achievements(
      "fixture",
      "launchbox"
    );
    assert.equal(
      retained.filter((row: { unlocked: boolean }) => row.unlocked).length,
      1
    );
    const changed = waitFor("update");
    const replacement = path.join(trophy, "replacement");
    await fs.writeFile(replacement, data(true));
    await fs.rename(replacement, file);
    await changed;
    // Notification delivery follows the update after preferences have been loaded.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.notifications.length, 1);
    assert.equal(
      state.notifications[0].achievements[0].trophyGrade,
      "platinum"
    );
    await provider.getRpcs3Achievements("fixture", "launchbox");
    assert.equal(state.notifications.length, 1);
    assert.equal(state.libraryRefreshes, 2);
    // A page request can observe a new unlock before the debounced watch callback.
    // It must notify once, and the subsequent watch refresh must not repeat it.
    await fs.writeFile(file, data(false));
    await provider.getRpcs3Achievements("fixture", "launchbox");
    await fs.writeFile(file, data(true));
    await provider.getRpcs3Achievements("fixture", "launchbox");
    assert.equal(state.notifications.length, 2);
    await provider.getRpcs3Achievements("fixture", "launchbox");
    assert.equal(state.notifications.length, 2);
    await t.test(
      "never publishes a partial collection when one set fails",
      async () => {
        const secondId = "NPWR12346_00";
        const secondMedia = path.join(
          game.selectedDiscPath,
          "TROPDIR",
          secondId
        );
        const secondTrophies = path.join(home, "00000001", "trophy", secondId);
        await fs.mkdir(secondMedia);
        await fs.mkdir(secondTrophies);
        const xml = await fs.readFile(
          path.join(trophy, "TROPCONF.SFM"),
          "utf8"
        );
        await fs.writeFile(
          path.join(secondTrophies, "TROPCONF.SFM"),
          xml.replaceAll(setId, secondId)
        );
        await fs.writeFile(
          path.join(secondTrophies, "TROPUSR.DAT"),
          data(false)
        );
        const complete = await provider.getRpcs3Achievements(
          "fixture",
          "launchbox"
        );
        assert.equal(complete.length, 4);
        assert.equal(
          complete.filter((row: { unlocked: boolean }) => row.unlocked).length,
          3
        );
        const refreshes = state.libraryRefreshes;
        await fs.writeFile(file, data(false));
        await fs.writeFile(
          path.join(secondTrophies, "TROPUSR.DAT"),
          Buffer.alloc(12)
        );
        const retainedCollection = await provider.getRpcs3Achievements(
          "fixture",
          "launchbox"
        );
        assert.deepEqual(retainedCollection, complete);
        assert.equal(state.libraryRefreshes, refreshes);
        await fs.writeFile(
          path.join(secondTrophies, "TROPUSR.DAT"),
          data(false)
        );
        const recoveredCollection = await provider.getRpcs3Achievements(
          "fixture",
          "launchbox"
        );
        assert.equal(recoveredCollection.length, 4);
        assert.equal(
          recoveredCollection.filter(
            (row: { unlocked: boolean }) => row.unlocked
          ).length,
          2
        );
        assert.equal(state.notifications.length, 2);
        for (const directory of [secondMedia, secondTrophies]) {
          assert.ok(path.resolve(directory).startsWith(root + path.sep));
          await fs.rm(directory, { recursive: true });
        }
        await provider.getRpcs3Achievements("fixture", "launchbox");
      }
    );
    await t.test(
      "retains progress and watches while the same media is unavailable, then recovers",
      async () => {
        await fs.writeFile(file, data(false));
        await provider.getRpcs3Achievements("fixture", "launchbox");
        const media = game.selectedDiscPath;
        const offline = path.join(root, "offline-media");
        await fs.rename(media, offline);
        const refreshes = state.libraryRefreshes;
        const rows = await provider.getRpcs3Achievements(
          "fixture",
          "launchbox"
        );
        assert.equal(rows.length, 2);
        assert.equal(
          rows.filter((row: { unlocked: boolean }) => row.unlocked).length,
          1
        );
        assert.equal(state.libraryRefreshes, refreshes);
        const deferred = waitFor("warning");
        await fs.writeFile(file, data(true));
        await deferred;
        assert.equal(state.notifications.length, 2);
        const recovered = waitFor("update");
        await fs.rename(offline, media);
        await recovered;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(state.notifications.length, 3);
        await provider.getRpcs3Achievements("fixture", "launchbox");
        assert.equal(state.notifications.length, 3);
      }
    );
    await t.test(
      "discards old progress when different media cannot be read",
      async () => {
        const media = game.selectedDiscPath;
        game.selectedDiscPath = path.join(root, "different-unavailable-media");
        assert.deepEqual(
          await provider.getRpcs3Achievements("fixture", "launchbox"),
          []
        );
        game.selectedDiscPath = media;
        assert.equal(
          (await provider.getRpcs3Achievements("fixture", "launchbox")).length,
          2
        );
        assert.equal(state.notifications.length, 3);
      }
    );
    await fs.mkdir(path.join(home, "00000002"));
    await fs.writeFile(settings, "[Users]\nactive_user=00000002\n");
    await fs.rename(game.selectedDiscPath, path.join(root, "offline-media"));
    assert.deepEqual(
      await provider.getRpcs3Achievements("fixture", "launchbox"),
      []
    );
    assert.equal(state.notifications.length, 3);
    assert.equal(await provider.getRpcs3Achievements("fixture", "steam"), null);
  }
);
