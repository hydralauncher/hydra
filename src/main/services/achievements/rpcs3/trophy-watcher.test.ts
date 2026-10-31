import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { TrophyWatcher } from "./trophy-watcher.js";

it(
  "receives atomic replacements and retries a transient read without idle polling",
  { timeout: 6000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-trophy-watch-")
    );
    const file = path.join(root, "TROPUSR.DAT");
    await fs.writeFile(file, "locked");
    let calls = 0;
    let finish!: () => void;
    const updated = new Promise<void>((resolve, reject) => {
      // Production watches and retry timers are deliberately unreferenced.
      // Keep this bounded event wait alive even when no filesystem I/O remains.
      const timeout = setTimeout(
        () => reject(new Error("No trophy update after atomic replacement")),
        5000
      );
      t.after(() => clearTimeout(timeout));
      finish = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    const watcher = new TrophyWatcher(async () => {
      calls++;
      if (calls === 1) throw new Error("transient read");
      if ((await fs.readFile(file, "utf8")) === "earned") finish();
    });
    t.after(async () => {
      watcher.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    watcher.setDirectories([root]);
    await fs.writeFile(path.join(root, "replacement"), "earned");
    await fs.rename(path.join(root, "replacement"), file);
    await updated;
    assert.equal(calls, 2);
    watcher.close();
    await fs.writeFile(file, "later");
    assert.equal(calls, 2);
  }
);
