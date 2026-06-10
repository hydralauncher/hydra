#!/usr/bin/env node
/*
 * PS2 memory card parser verification / inspection tool.
 *
 *   node scripts/inspect-ps2-memcard.cjs                      # synthetic self-test (PASS/FAIL)
 *   node scripts/inspect-ps2-memcard.cjs <Mcd001.ps2>         # inspect a real card
 *   node scripts/inspect-ps2-memcard.cjs <Mcd001.ps2> --export "BASLUS-20552" [out.psu]
 *
 * The parser modules are pure Node (no @main/@types aliases), so we register
 * ts-node with an isolated commonjs config (skipProject) and require the .ts
 * sources directly — no app build required.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// package.json is "type": "module", so we can't require() the .ts sources. The
// parser package is pure/alias-free, so bundle it to a temp CJS module with
// esbuild (already a dependency) and require that.
const esbuild = require("esbuild");

const ENTRY = path.join(
  __dirname,
  "..",
  "src/main/services/emulators/ps2-memory-card/index.ts"
);
const bundled = esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const tmpBundle = path.join(
  os.tmpdir(),
  `hydra-ps2mc-bundle-${process.pid}.cjs`
);
fs.writeFileSync(tmpBundle, bundled.outputFiles[0].text);
process.on("exit", () => {
  try {
    fs.unlinkSync(tmpBundle);
  } catch {
    /* ignore */
  }
});

const {
  listSaves,
  readSaveContents,
  buildPsuBuffer,
  LocalPsuBackup,
  exportSaveToPsu,
  extractSkuFromSaveFolder,
  importPsuIntoCard,
  computePageSpare,
} = require(tmpBundle);

// ── Tiny assertion harness ──────────────────────────────────────────────────
let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}`);
  if (!cond) failures += 1;
};
const eq = (label, got, want) =>
  check(
    `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`,
    got === want
  );

// ── Synthetic card builder (written from the spec, independent of the parser) ──
const PAGE = 512;
const PPC = 2;
const CLUSTER = PAGE * PPC; // 1024
const CLUSTERS = 16; // image = 16 * 1024 = 16384 bytes (no ECC)
const ALLOC_OFFSET = 8;
const DF_FILE = 0x10;
const DF_DIR = 0x20;
const DF_EXISTS = 0x8000;
const DIR_MODE = DF_DIR | DF_EXISTS | 0x7;
const FILE_MODE = DF_FILE | DF_EXISTS | 0x7;
const FAT_ALLOC = 0x80000000;
const FAT_END = 0xffffffff; // alloc bit + 0x7fffffff end-of-chain
const PS2_FORMAT_VERSION = [1, 2, 0, 0].join(".");

const tod = () => {
  const b = Buffer.alloc(8);
  b[1] = 30; // sec
  b[2] = 45; // min
  b[3] = 12; // hour
  b[4] = 15; // day
  b[5] = 6; // month
  b.writeUInt16LE(2021, 6); // year
  return b;
};

const dirEntry = ({ mode, length, cluster, name }) => {
  const e = Buffer.alloc(512);
  e.writeUInt16LE(mode, 0x00);
  e.writeUInt32LE(length >>> 0, 0x04);
  tod().copy(e, 0x08);
  e.writeUInt32LE(cluster >>> 0, 0x10);
  tod().copy(e, 0x18);
  Buffer.from(name, "latin1").copy(e, 0x40, 0, Math.min(name.length, 32));
  return e;
};

const buildSyntheticCard = () => {
  const img = Buffer.alloc(CLUSTERS * CLUSTER);
  const writeCluster = (abs, buf) => buf.copy(img, abs * CLUSTER);

  // Superblock (cluster 0)
  const sb = Buffer.alloc(CLUSTER);
  sb.write("Sony PS2 Memory Card Format ", 0, "latin1");
  sb.write(PS2_FORMAT_VERSION, 0x1c, "latin1");
  sb.writeUInt16LE(PAGE, 0x28);
  sb.writeUInt16LE(PPC, 0x2a);
  sb.writeUInt16LE(16, 0x2c);
  sb.writeUInt32LE(CLUSTERS, 0x30);
  sb.writeUInt32LE(ALLOC_OFFSET, 0x34);
  sb.writeUInt32LE(CLUSTERS, 0x38);
  sb.writeUInt32LE(0, 0x3c); // rootDirCluster (relative)
  sb.writeUInt32LE(1, 0x50); // ifcList[0] -> indirect FAT cluster (abs 1)
  sb.writeInt8(2, 0x150); // cardType
  sb.writeInt8(0x2b, 0x151); // cardFlags
  writeCluster(0, sb);

  // Indirect FAT (cluster 1) -> FAT cluster at abs 2
  const ind = Buffer.alloc(CLUSTER);
  ind.writeUInt32LE(2, 0);
  writeCluster(1, ind);

  // FAT (cluster 2), indexed by RELATIVE allocatable cluster
  const fat = Buffer.alloc(CLUSTER);
  const setFat = (rel, val) => fat.writeUInt32LE(val >>> 0, rel * 4);
  setFat(0, FAT_ALLOC | 1); // root dir cluster 0 -> 1
  setFat(1, FAT_END); //        root dir cluster 1 -> end
  setFat(2, FAT_ALLOC | 3); // save folder dir 2 -> 3
  setFat(3, FAT_END); //        save folder dir 3 -> end
  setFat(4, FAT_END); //        icon.sys data (single cluster)
  setFat(5, FAT_ALLOC | 6); // test.dat data 5 -> 6
  setFat(6, FAT_END); //        test.dat data 6 -> end
  writeCluster(2, fat);

  // Root directory (abs 8,9 = rel 0,1). length=3 in the "." entry.
  writeCluster(
    8,
    dirEntry({ mode: DIR_MODE, length: 3, cluster: 0, name: "." })
  );
  img.set(
    dirEntry({ mode: DIR_MODE, length: 3, cluster: 0, name: ".." }),
    8 * CLUSTER + 512
  );
  writeCluster(
    9,
    dirEntry({ mode: DIR_MODE, length: 4, cluster: 2, name: "BASLUS-12345" })
  );

  // Save folder directory (abs 10,11 = rel 2,3). length=4.
  writeCluster(
    10,
    dirEntry({ mode: DIR_MODE, length: 4, cluster: 2, name: "." })
  );
  img.set(
    dirEntry({ mode: DIR_MODE, length: 3, cluster: 0, name: ".." }),
    10 * CLUSTER + 512
  );
  writeCluster(
    11,
    dirEntry({ mode: FILE_MODE, length: 100, cluster: 4, name: "icon.sys" })
  );
  img.set(
    dirEntry({ mode: FILE_MODE, length: 2000, cluster: 5, name: "test.dat" }),
    11 * CLUSTER + 512
  );

  // File data
  const icon = Buffer.alloc(100, 0xab);
  writeCluster(12, icon);
  const test = Buffer.alloc(2000);
  for (let i = 0; i < test.length; i += 1) test[i] = i & 0xff;
  test.copy(img, 13 * CLUSTER); // spans abs 13 (1024) + abs 14 (976)

  return { img, icon, test };
};

// A roomy, empty (no saves) card with plenty of free clusters, for write tests.
// Optionally emit it in ECC layout (528-byte raw pages).
const buildEmptyCard = (numClusters, withEcc) => {
  const img = Buffer.alloc(numClusters * CLUSTER);
  const writeCluster = (abs, buf) => buf.copy(img, abs * CLUSTER);

  const sb = Buffer.alloc(CLUSTER);
  sb.write("Sony PS2 Memory Card Format ", 0, "latin1");
  sb.write(PS2_FORMAT_VERSION, 0x1c, "latin1");
  sb.writeUInt16LE(PAGE, 0x28);
  sb.writeUInt16LE(PPC, 0x2a);
  sb.writeUInt16LE(16, 0x2c);
  sb.writeUInt32LE(numClusters, 0x30);
  sb.writeUInt32LE(ALLOC_OFFSET, 0x34);
  sb.writeUInt32LE(numClusters, 0x38);
  sb.writeUInt32LE(0, 0x3c); // rootDirCluster (relative)
  sb.writeUInt32LE(1, 0x50); // ifcList[0]
  sb.writeInt8(2, 0x150);
  sb.writeInt8(0x2b, 0x151);
  writeCluster(0, sb);

  const ind = Buffer.alloc(CLUSTER);
  ind.writeUInt32LE(2, 0);
  writeCluster(1, ind);

  const fat = Buffer.alloc(CLUSTER); // rel0 = root (end of chain); rest free (0)
  fat.writeUInt32LE(FAT_END >>> 0, 0);
  writeCluster(2, fat);

  // Empty root directory at abs 8 (rel 0): just "." (count 2) and "..".
  writeCluster(
    8,
    dirEntry({ mode: DIR_MODE, length: 2, cluster: 0, name: "." })
  );
  img.set(
    dirEntry({ mode: DIR_MODE, length: 2, cluster: 0, name: ".." }),
    8 * CLUSTER + 512
  );

  if (!withEcc) return img;

  // Expand to ECC layout: each 512-byte page gets a 16-byte spare.
  const RAW = PAGE + 16;
  const pages = numClusters * PPC;
  const out = Buffer.alloc(pages * RAW);
  for (let p = 0; p < pages; p += 1) {
    const data = img.subarray(p * PAGE, p * PAGE + PAGE);
    data.copy(out, p * RAW);
    computePageSpare(data, 16).copy(out, p * RAW + PAGE);
  }
  return out;
};

const testExtractSku = () => {
  console.log("extractSkuFromSaveFolder:");
  eq("BASLUS-20552", extractSkuFromSaveFolder("BASLUS-20552"), "SLUS-20552");
  eq("BESLES-50009", extractSkuFromSaveFolder("BESLES-50009"), "SLES-50009");
  eq("BISLPM-65530", extractSkuFromSaveFolder("BISLPM-65530"), "SLPM-65530");
  eq("bare SLUS-20552", extractSkuFromSaveFolder("SLUS-20552"), "SLUS-20552");
  // Real folders carry a game-specific suffix after the serial (see settings UI).
  eq(
    "BASCUS-97481GOWII (suffix)",
    extractSkuFromSaveFolder("BASCUS-97481GOWII"),
    "SCUS-97481"
  );
  eq(
    "BASLUS-20294USER (suffix)",
    extractSkuFromSaveFolder("BASLUS-20294USER"),
    "SLUS-20294"
  );
  eq(
    "BESLES-52988XXX (suffix)",
    extractSkuFromSaveFolder("BESLES-52988XXX"),
    "SLES-52988"
  );
  eq("BIEXEC-SYSTEM", extractSkuFromSaveFolder("BIEXEC-SYSTEM"), null);
  eq("BADATA-SYSTEM", extractSkuFromSaveFolder("BADATA-SYSTEM"), null);
  eq("BWNETCNF", extractSkuFromSaveFolder("BWNETCNF"), null);
  eq(
    "unknown prefix BAXYZW-12345",
    extractSkuFromSaveFolder("BAXYZW-12345"),
    null
  );
};

const collectPsuRecords = (psu) => {
  let off = 512 * 3;
  const seen = [];
  while (off < psu.length) {
    const rec = psu.subarray(off, off + 512);
    const mode = rec.readUInt16LE(0);
    const len = rec.readUInt32LE(4);
    const nameBuf = rec.subarray(0x40, 0x40 + 32);
    const nul = nameBuf.indexOf(0);
    const nameEnd = nul === -1 ? 32 : nul;
    const name = nameBuf.subarray(0, nameEnd).toString("latin1");
    off += 512;
    const padded = Math.ceil(len / 1024) * 1024;
    check(`psu data segment for ${name} is 1024-aligned`, padded % 1024 === 0);
    off += padded;
    seen.push({ name, len, isFile: (mode & DF_FILE) !== 0 });
  }
  return { seen, off };
};

const testParseAndExport = async (tmp, icon, test) => {
  console.log("\nlistSaves:");
  const info = await listSaves(tmp);
  check("card parsed (non-null)", info !== null);
  if (!info) throw new Error("parse failed");
  eq("hasEcc", info.hasEcc, false);
  eq("rawPageSize", info.rawPageSize, 512);
  eq("save count", info.saves.length, 1);
  const save = info.saves[0];
  eq("folderName", save.folderName, "BASLUS-12345");
  eq("sku", save.sku, "SLUS-12345");
  eq("fileCount", save.fileCount, 2);
  eq("sizeBytes", save.sizeBytes, 2100);

  console.log("\nreadSaveContents:");
  const contents = await readSaveContents(tmp, "BASLUS-12345");
  check("contents non-null", contents !== null);
  if (!contents) throw new Error("readSaveContents failed");
  eq("files length", contents.files.length, 2);
  const iconFile = contents.files.find((f) => f.name === "icon.sys");
  const testFile = contents.files.find((f) => f.name === "test.dat");
  check("icon.sys present", !!iconFile);
  check("test.dat present", !!testFile);
  eq("icon.sys length", iconFile?.length, 100);
  eq("test.dat length", testFile?.length, 2000);
  check("icon.sys bytes match", iconFile?.data.equals(icon));
  check("test.dat bytes match (spans 2 clusters)", testFile?.data.equals(test));

  console.log("\nbuildPsuBuffer round-trip:");
  const psu = buildPsuBuffer(contents);
  const expectedTotal = 512 * 3 + (512 + 1024) + (512 + 2048);
  eq("psu total bytes", psu.length, expectedTotal);

  const dirRec = psu.subarray(0, 512);
  eq(
    "psu dir mode is DIR|EXISTS",
    (dirRec.readUInt16LE(0) & (DF_DIR | DF_EXISTS)) === (DF_DIR | DF_EXISTS),
    true
  );
  eq("psu dir length == files+2", dirRec.readUInt32LE(4), 4);
  const dirName = dirRec.subarray(0x40, 0x40 + 12).toString("latin1");
  eq("psu dir name", dirName, "BASLUS-12345");

  const { seen, off } = collectPsuRecords(psu);
  eq("psu file-record count", seen.length, 2);
  eq("psu offset consumed exactly", off, psu.length);
  check(
    "psu has icon.sys (100)",
    seen.some((s) => s.name === "icon.sys" && s.len === 100 && s.isFile)
  );
  check(
    "psu has test.dat (2000)",
    seen.some((s) => s.name === "test.dat" && s.len === 2000 && s.isFile)
  );

  console.log("\nexportSaveToPsu (LocalPsuBackup seam):");
  const outPath = path.join(os.tmpdir(), `hydra-synth-${process.pid}.psu`);
  const res = await exportSaveToPsu(
    tmp,
    "BASLUS-12345",
    new LocalPsuBackup(outPath),
    { readSaveContents }
  );
  eq("export location", res.location, outPath);
  eq("export sizeBytes", res.sizeBytes, expectedTotal);
  check(
    "export file written",
    fs.existsSync(outPath) && fs.statSync(outPath).size === expectedTotal
  );
  check(
    "exported bytes equal buildPsuBuffer",
    fs.readFileSync(outPath).equals(psu)
  );
  fs.unlinkSync(outPath);

  console.log("\nECC (computePageSpare):");
  const zeroPage = Buffer.alloc(512);
  const zeroSpare = computePageSpare(zeroPage, 16);
  eq("zero chunk ecc[0]", zeroSpare[0], 0x77);
  eq("zero chunk ecc[1]", zeroSpare[1], 0x7f);
  eq("zero chunk ecc[2]", zeroSpare[2], 0x7f);
  eq("zero spare is 16 bytes", zeroSpare.length, 16);
  const onePage = Buffer.alloc(512);
  onePage[0] = 0x01;
  const oneSpare = computePageSpare(onePage, 16);
  eq("{0x01} chunk ecc[0]", oneSpare[0], 0x70);
  eq("{0x01} chunk ecc[1]", oneSpare[1], 0x00);
  eq("{0x01} chunk ecc[2]", oneSpare[2], 0x7f);

  return psu;
};

const testImportCase = async (withEcc, psu, icon, test) => {
  const label = withEcc ? "ECC" : "raw";
  console.log(`\nimportPsuIntoCard (${label} card):`);
  const target = path.join(
    os.tmpdir(),
    `hydra-import-${process.pid}-${label}.ps2`
  );
  fs.writeFileSync(target, buildEmptyCard(64, withEcc));
  try {
    const result = await importPsuIntoCard(target, psu);
    check(`[${label}] import ok`, result.ok === true);
    if (!result.ok) console.log("   error:", result.error);

    const info2 = await listSaves(target);
    eq(`[${label}] hasEcc`, info2?.hasEcc, withEcc);
    eq(`[${label}] save count`, info2?.saves.length, 1);
    eq(`[${label}] folderName`, info2?.saves[0]?.folderName, "BASLUS-12345");

    const c2 = await readSaveContents(target, "BASLUS-12345");
    check(`[${label}] contents read back`, !!c2);
    if (c2) {
      const icon2 = c2.files.find((f) => f.name === "icon.sys");
      const test2 = c2.files.find((f) => f.name === "test.dat");
      check(`[${label}] icon.sys bytes`, icon2?.data.equals(icon));
      check(`[${label}] test.dat bytes`, test2?.data.equals(test));
    }

    const r2 = await importPsuIntoCard(target, psu);
    check(`[${label}] re-import (replace) ok`, r2.ok === true);
    const info3 = await listSaves(target);
    eq(`[${label}] one save after replace`, info3?.saves.length, 1);
  } finally {
    fs.unlinkSync(target);
  }
};

const runSelfTest = async () => {
  console.log("PS2 memory card parser — synthetic self-test\n");

  testExtractSku();

  const { img, icon, test } = buildSyntheticCard();
  const tmp = path.join(os.tmpdir(), `hydra-synth-card-${process.pid}.ps2`);
  fs.writeFileSync(tmp, img);

  try {
    const psu = await testParseAndExport(tmp, icon, test);
    for (const withEcc of [false, true]) {
      await testImportCase(withEcc, psu, icon, test);
    }
  } finally {
    fs.unlinkSync(tmp);
  }

  const summary = failures === 0 ? "ALL PASS ✅" : `${failures} FAILURE(S) ❌`;
  console.log(`\n${summary}`);
  process.exit(failures === 0 ? 0 : 1);
};

const inspectReal = async (cardPath, exportFolder, outPath) => {
  const info = await listSaves(cardPath);
  if (!info) {
    console.error(`Not a readable PS2 memory card: ${cardPath}`);
    process.exit(1);
  }
  const sb = info.superblock;
  console.log(`Card: ${cardPath}`);
  console.log(`  ECC: ${info.hasEcc} (rawPageSize ${info.rawPageSize})`);
  console.log(
    `  superblock: pageLen=${sb.pageLen} clusterSize=${sb.clusterSize} clusters=${sb.clustersPerCard} allocOffset=${sb.allocOffset} rootDirCluster=${sb.rootDirCluster}`
  );
  console.log(`  saves: ${info.saves.length}`);
  for (const s of info.saves) {
    const date = s.modifiedSecs
      ? new Date(s.modifiedSecs * 1000).toISOString()
      : "?";
    console.log(
      `    ${s.folderName.padEnd(20)} sku=${String(s.sku).padEnd(12)} files=${String(s.fileCount).padStart(3)} ${String(s.sizeBytes).padStart(9)}B  ${date}`
    );
  }

  if (exportFolder) {
    const dest = outPath || path.join(process.cwd(), `${exportFolder}.psu`);
    const res = await exportSaveToPsu(
      cardPath,
      exportFolder,
      new LocalPsuBackup(dest),
      {
        readSaveContents,
      }
    );
    console.log(
      `\nExported "${exportFolder}" -> ${res.location} (${res.sizeBytes} bytes)`
    );
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) return runSelfTest();
  const cardPath = args[0];
  const exportIdx = args.indexOf("--export");
  const exportFolder = exportIdx >= 0 ? args[exportIdx + 1] : null;
  const outPath = exportIdx >= 0 ? args[exportIdx + 2] : null;
  return inspectReal(cardPath, exportFolder, outPath);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
