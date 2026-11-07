import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { TrophyWatcher, TrophyWatchRegistry } from "./trophy-watcher.js";

it("shares directory handles, updates filters without reopening, and recovers failed watches", () => {
  const handles: Array<{
    directory: string;
    changed: (filename: string | null) => void;
    failed: (error: unknown) => void;
    closed: boolean;
  }> = [];
  const registry = new TrophyWatchRegistry((directory, changed, failed) => {
    const handle = { directory, changed, failed, closed: false };
    handles.push(handle);
    return {
      close: () => {
        handle.closed = true;
      },
    };
  });
  const root = path.resolve("shared-profile");
  const events: string[] = [];
  const errors: unknown[] = [];
  const first = new TrophyWatcher(
    async () => {},
    (error) => errors.push(error),
    registry
  );
  const second = new TrophyWatcher(
    async () => {},
    (error) => errors.push(error),
    registry
  );
  first.trigger = () => {
    events.push("first");
  };
  second.trigger = () => {
    events.push("second");
  };
  const filter = (name: string) => new Map([[root, new Set([name])]]);
  try {
    first.setDirectories([root], filter("first"));
    second.setDirectories([root], filter("second"));
    assert.equal(handles.length, 1);
    first.setDirectories([root], filter("changed"));
    second.setDirectories([root], filter("second"));
    assert.equal(handles.length, 1);
    assert.equal(handles[0].closed, false);
    handles[0].changed("first");
    assert.deepEqual(events, []);
    handles[0].changed("changed");
    handles[0].changed("second");
    assert.deepEqual(events, ["first", "second"]);
    handles[0].changed(null);
    assert.deepEqual(events.slice(2), ["first", "second"]);
    first.close();
    assert.equal(handles[0].closed, false);
    handles[0].changed("second");
    assert.equal(events.at(-1), "second");
    const error = new Error("directory watch failed");
    handles[0].failed(error);
    assert.deepEqual(errors, [error]);
    assert.equal(handles[0].closed, true);
    second.setDirectories([root], filter("second"));
    assert.equal(handles.length, 2);
    handles[0].failed(new Error("late error from a closed watch"));
    assert.deepEqual(errors, [error]);
    handles[1].changed("second");
    assert.equal(events.at(-1), "second");
    // Removing a path releases it; unchanged paths retain their live handle.
    const extra = path.join(root, "set");
    second.setDirectories([root, extra], filter("second"));
    assert.equal(handles.length, 3);
    second.setDirectories([root], filter("second"));
    assert.equal(handles[2].closed, true);
    assert.equal(handles[1].closed, false);
  } finally {
    first.close();
    second.close();
  }
  assert.ok(handles.every((handle) => handle.closed));
});

it("uses six shared profile handles for twenty game monitors and releases all on shutdown", () => {
  let opened = 0;
  let closed = 0;
  const registry = new TrophyWatchRegistry(() => {
    opened++;
    return {
      close: () => {
        closed++;
      },
    };
  });
  const directories = Array.from({ length: 6 }, (_, index) =>
    path.resolve(`profile-${index}`)
  );
  const monitors = Array.from(
    { length: 20 },
    () => new TrophyWatcher(async () => {}, undefined, registry)
  );
  try {
    for (const monitor of monitors) monitor.setDirectories(directories);
    assert.equal(opened, 6);
    for (const monitor of monitors) monitor.setDirectories(directories);
    assert.equal(opened, 6);
    assert.equal(closed, 0);
    for (const monitor of monitors.slice(0, -1)) monitor.close();
    assert.equal(closed, 0);
    monitors.at(-1)!.close();
    assert.equal(closed, 6);
  } finally {
    for (const monitor of monitors) monitor.close();
  }
});

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
