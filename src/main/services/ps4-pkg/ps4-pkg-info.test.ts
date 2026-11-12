import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { Ps4PkgError, readPs4PkgInfo } from "./ps4-pkg-info.js";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ps4-pkg-info-"));
after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

const buildParamSfo = (values: Record<string, string>) => {
  const entries = Object.entries(values);
  const keyTable = Buffer.concat(
    entries.map(([key]) => Buffer.from(`${key}\0`, "latin1"))
  );
  const dataSlots = entries.map(([, value]) => {
    const slot = Buffer.alloc(Math.ceil((value.length + 1) / 4) * 4);
    slot.write(value, "latin1");
    return slot;
  });
  const keyTableStart = 20 + entries.length * 16;
  const dataTableStart = keyTableStart + Math.ceil(keyTable.length / 4) * 4;
  const header = Buffer.alloc(dataTableStart);
  header.writeUInt32LE(0x46535000, 0);
  header.writeUInt32LE(0x101, 4);
  header.writeUInt32LE(keyTableStart, 8);
  header.writeUInt32LE(dataTableStart, 12);
  header.writeUInt32LE(entries.length, 16);

  let keyOffset = 0;
  let dataOffset = 0;
  entries.forEach(([key, value], index) => {
    const position = 20 + index * 16;
    header.writeUInt16LE(keyOffset, position);
    header.writeUInt16LE(0x0204, position + 2);
    header.writeUInt32LE(value.length + 1, position + 4);
    header.writeUInt32LE(dataSlots[index].length, position + 8);
    header.writeUInt32LE(dataOffset, position + 12);
    keyOffset += key.length + 1;
    dataOffset += dataSlots[index].length;
  });
  keyTable.copy(header, keyTableStart);

  return Buffer.concat([header, ...dataSlots]);
};

const writePkg = (
  name: string,
  { category, flags = 0 }: { category: string; flags?: number }
) => {
  const names = Buffer.from("\0param.sfo\0", "latin1");
  const paramSfo = buildParamSfo({
    CATEGORY: category,
    APP_VER: "01.09",
    TITLE_ID: "CUSA03173",
  });
  const tableOffset = 0x1000;
  const namesOffset = tableOffset + 2 * 32;
  const paramSfoOffset = namesOffset + 0x20;

  const pkg = Buffer.alloc(paramSfoOffset + paramSfo.length);
  pkg.writeUInt32BE(0x7f434e54, 0);
  pkg.writeUInt32BE(2, 0x10);
  pkg.writeUInt32BE(tableOffset, 0x18);
  pkg.write("EP9000-CUSA03173_00-BLOODBORNE0000E", 0x40, "latin1");
  pkg.writeUInt32BE(flags, 0x78);
  pkg.writeBigUInt64BE(0x200000n, 0x410);
  pkg.writeBigUInt64BE(0x100000n, 0x418);

  const writeEntry = (
    index: number,
    id: number,
    nameOffset: number,
    offset: number,
    size: number
  ) => {
    const position = tableOffset + index * 32;
    pkg.writeUInt32BE(id, position);
    pkg.writeUInt32BE(nameOffset, position + 4);
    pkg.writeUInt32BE(offset, position + 16);
    pkg.writeUInt32BE(size, position + 20);
  };
  writeEntry(0, 0x200, 0, namesOffset, names.length);
  writeEntry(1, 0x1000, 1, paramSfoOffset, paramSfo.length);
  names.copy(pkg, namesOffset);
  paramSfo.copy(pkg, paramSfoOffset);

  const pkgPath = path.join(tempDirectory, name);
  fs.writeFileSync(pkgPath, pkg);
  return pkgPath;
};

describe("readPs4PkgInfo", () => {
  it("reads the title, kind and version of a game PKG", async () => {
    const info = await readPs4PkgInfo(writePkg("game.pkg", { category: "gd" }));

    assert.equal(info.titleId, "CUSA03173");
    assert.equal(info.kind, "game");
    assert.equal(info.isDeltaPatch, false);
    assert.match(info.appVersion ?? "", /0109/);
    assert.equal(
      info.entries.find((entry) => entry.id === 0x1000)?.name,
      "param.sfo"
    );
  });

  it("tells updates apart and flags delta updates", async () => {
    const cumulative = await readPs4PkgInfo(
      writePkg("patch.pkg", { category: "gp", flags: 0x60000000 })
    );
    const delta = await readPs4PkgInfo(
      writePkg("delta.pkg", { category: "gp", flags: 0x41000000 })
    );

    assert.equal(cumulative.kind, "patch");
    assert.equal(cumulative.isDeltaPatch, false);
    assert.equal(delta.isDeltaPatch, true);
  });

  it("reads add-ons as add-ons", async () => {
    const info = await readPs4PkgInfo(writePkg("dlc.pkg", { category: "ac" }));
    assert.equal(info.kind, "addon");
  });

  it("rejects files that are not PS4 PKGs", async () => {
    const notPkg = path.join(tempDirectory, "not.pkg");
    fs.writeFileSync(notPkg, Buffer.alloc(0x1000));

    await assert.rejects(
      readPs4PkgInfo(notPkg),
      (error: unknown) =>
        error instanceof Ps4PkgError && error.code === "not_ps4_pkg"
    );
  });
});
