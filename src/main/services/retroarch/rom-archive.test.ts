import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { promisify } from "node:util";
import { listArchiveEntries, readArchiveEntry } from "../archive-entry.js";
import { crc32, hashRomBuffer, hashRomFile } from "./rom-hash.js";
import { extensionToPlatform } from "./retroarch-cores.js";
import {
  isRetroArchArchive,
  inspectRomArchives,
  MAX_ARCHIVED_ROM_BYTES,
  selectArchivedRom,
} from "./rom-archive.js";
import { getRetroArchRomExtensions } from "../../../shared/retroarch-platform.js";

const execFileAsync = promisify(execFile);
const binaryNames = { darwin: "7zz", linux: "7zzs", win32: "7z.exe" };
const binaryPath = path.resolve("binaries", binaryNames[process.platform]);

it("offers archives for every platform without inferring a platform from ZIP", () => {
  for (const platform of ["nes", "snes", "n64", "gb", "gbc", "gba"] as const) {
    assert.ok(getRetroArchRomExtensions(platform).includes("zip"));
    assert.ok(getRetroArchRomExtensions(platform).includes("7z"));
  }
  assert.equal(extensionToPlatform("game.zip"), null);
  assert.equal(extensionToPlatform("game.GBC"), "gbc");
  assert.equal(isRetroArchArchive("game.ZIP"), true);
  assert.equal(isRetroArchArchive("game.7Z"), true);
  assert.equal(isRetroArchArchive("game.rar"), false);
});

it("identifies the enclosed ROM even when the archive name suggests another platform", () => {
  assert.deepEqual(
    selectArchivedRom([
      { name: "readme.txt", size: 20 },
      { name: "nested/Game.GBA", size: 64 },
    ]),
    { name: "nested/Game.GBA", size: 64, platform: "gba" }
  );
});

it("does not map empty, unrelated, oversized or ambiguous archives", () => {
  for (const entries of [
    [],
    [{ name: "image.iso", size: 1024 }],
    [{ name: "empty.nes", size: 0 }],
    [{ name: "secret.nes", size: 32, encrypted: true }],
    [{ name: "huge.nes", size: MAX_ARCHIVED_ROM_BYTES + 1 }],
    [
      { name: "one.nes", size: 32 },
      { name: "two.nes", size: 32 },
    ],
    [
      { name: "one.nes", size: 32 },
      { name: "two.gba", size: 32 },
    ],
  ])
    assert.equal(selectArchivedRom(entries), null);
});

it("hashes archived ROM bytes exactly like plain ROM files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-rom-hash-"));
  try {
    const payload = Buffer.from("123456789");
    assert.equal(crc32(payload), "CBF43926");
    const nes = Buffer.concat([
      Buffer.from([0x4e, 0x45, 0x53, 0x1a]),
      Buffer.alloc(12),
      payload,
    ]);
    const fds = Buffer.from(nes);
    fds.set([0x46, 0x44, 0x53, 0x1a]);
    const snes = Buffer.concat([Buffer.alloc(512, 42), Buffer.alloc(1024, 5)]);
    const n64 = Buffer.from([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4]);
    const v64 = Buffer.from(n64).swap16();
    const littleN64 = Buffer.from(n64).swap32();
    const fixtures = [
      ["nes", nes],
      ["nes", fds],
      ["snes", snes],
      ["n64", n64],
      ["n64", v64],
      ["n64", littleN64],
      ["gb", payload],
      ["gbc", payload],
      ["gba", payload],
    ] as const;
    for (const [platform, content] of fixtures) {
      const filePath = path.join(root, `game.${platform}`);
      await writeFile(filePath, content);
      const original = Buffer.from(content);
      assert.equal(
        hashRomBuffer(content, platform),
        await hashRomFile(filePath, platform)
      );
      assert.deepEqual(content, original);
    }
    assert.equal(hashRomBuffer(nes, "nes"), "CBF43926");
    assert.equal(hashRomBuffer(fds, "nes"), "CBF43926");
    assert.equal(hashRomBuffer(snes, "snes"), crc32(snes.subarray(512)));
    assert.equal(hashRomBuffer(v64, "n64"), crc32(n64));
    assert.equal(hashRomBuffer(littleN64, "n64"), crc32(n64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const format of ["zip", "7z"]) {
  it(
    `reads a real ${format} archive without extracting files`,
    { skip: !existsSync(binaryPath) },
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "hydra-rom-archive-"));
      try {
        const input = path.join(root, "input");
        await mkdir(path.join(input, "nested"), { recursive: true });
        const content = Buffer.concat([
          Buffer.from([0x4e, 0x45, 0x53, 0x1a]),
          Buffer.alloc(12),
          Buffer.from("123456789"),
        ]);
        const name = "nested/Game [USA] é.NES";
        await writeFile(path.join(input, name), content);
        await writeFile(path.join(input, "readme.txt"), "Not a ROM");
        const archivePath = path.join(root, `misleading.gba.${format}`);
        await execFileAsync(
          binaryPath,
          ["a", `-t${format}`, archivePath, "."],
          { cwd: input }
        );
        await rm(input, { recursive: true });
        const entries = await listArchiveEntries(binaryPath, archivePath);
        const rom = selectArchivedRom(entries);
        assert.deepEqual(rom, { name, size: content.length, platform: "nes" });
        const bytes = await readArchiveEntry(
          binaryPath,
          archivePath,
          rom!.name,
          MAX_ARCHIVED_ROM_BYTES
        );
        assert.deepEqual(bytes, content);
        const listingController = new AbortController();
        const listing = listArchiveEntries(
          binaryPath,
          archivePath,
          listingController.signal
        );
        listingController.abort();
        await assert.rejects(listing, { name: "AbortError" });
        const readingController = new AbortController();
        const reading = readArchiveEntry(
          binaryPath,
          archivePath,
          name,
          MAX_ARCHIVED_ROM_BYTES,
          readingController.signal
        );
        readingController.abort();
        await assert.rejects(reading, { name: "AbortError" });
        assert.equal(hashRomBuffer(bytes, "nes"), "CBF43926");
        assert.deepEqual(await readdir(root), [`misleading.gba.${format}`]);
        await assert.rejects(
          readArchiveEntry(binaryPath, archivePath, name, 4)
        );
        await writeFile(path.join(root, "broken.zip"), "invalid archive");
        await assert.rejects(
          listArchiveEntries(binaryPath, path.join(root, "broken.zip"))
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}

it(
  "reads literal archive entry names and rejects encrypted ROMs",
  { skip: !existsSync(binaryPath) },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hydra-archive-names-"));
    try {
      const input = path.join(root, "input");
      await mkdir(input);
      for (const name of ["@game.nes", "-game.nes", "game[1].nes"]) {
        await writeFile(path.join(input, name), name);
      }
      const archive = path.join(root, "names.zip");
      await execFileAsync(binaryPath, ["a", archive, "."], { cwd: input });
      for (const entry of await listArchiveEntries(binaryPath, archive)) {
        assert.equal(
          (
            await readArchiveEntry(binaryPath, archive, entry.name, 1024)
          ).toString(),
          entry.name
        );
      }
      const encrypted = path.join(root, "encrypted.zip");
      await execFileAsync(
        binaryPath,
        ["a", "-ppassword", encrypted, "game[1].nes"],
        { cwd: input }
      );
      assert.equal(
        selectArchivedRom(await listArchiveEntries(binaryPath, encrypted)),
        null
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("bounds archive inspection concurrency and preserves file order", async () => {
  let active = 0;
  let peak = 0;
  const files = Array.from({ length: 12 }, (_, index) => `${index}.zip`);
  const results = await inspectRomArchives(files, undefined, async (file) => {
    active += 1;
    peak = Math.max(peak, active);
    await setImmediate();
    active -= 1;
    return { name: file, size: 32, platform: "nes" };
  });
  assert.equal(peak, 4);
  assert.deepEqual(
    results.map((rom) => rom?.name),
    files
  );
});

it("cancels active inspections without opening queued archives", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  const files = Array.from({ length: 12 }, (_, index) => `${index}.zip`);
  const pending = inspectRomArchives(
    files,
    controller.signal,
    async (file, signal) => {
      assert.equal(signal, controller.signal);
      started.push(file);
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true })
      );
      return { name: file, size: 32, platform: "nes" };
    }
  );
  assert.equal(started.length, 4);
  controller.abort();
  assert.deepEqual(
    await pending,
    files.map(() => null)
  );
  assert.equal(started.length, 4);
});

it("skips plain files and already-cancelled archive scans", async () => {
  const inspect = async () => {
    assert.fail("Archive inspection should not start");
  };
  assert.deepEqual(await inspectRomArchives(["game.nes"], undefined, inspect), [
    null,
  ]);
  assert.deepEqual(
    await inspectRomArchives(["game.zip"], AbortSignal.abort(), inspect),
    [null]
  );
  assert.equal(await hashRomFile("game.zip", "nes", AbortSignal.abort()), null);
});
