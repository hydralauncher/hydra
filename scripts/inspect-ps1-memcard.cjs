#!/usr/bin/env node
/*
 * PS1 (DuckStation) memory card parser verification / inspection tool.
 *
 *   node scripts/inspect-ps1-memcard.cjs                       # synthetic self-test (PASS/FAIL)
 *   node scripts/inspect-ps1-memcard.cjs <card.mcd>            # inspect a real card
 *   node scripts/inspect-ps1-memcard.cjs <card.mcd> --export "BASLUS-20624..." [out.mcs]
 *
 * The parser modules are pure Node (no @main/@types aliases), so we bundle them
 * to a temp CJS module with esbuild (already a dependency) and require that —
 * no app build required.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const esbuild = require("esbuild");

const ENTRY = path.join(
  __dirname,
  "..",
  "src/main/services/emulators/ps1-memory-card/index.ts"
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
  `hydra-ps1mc-bundle-${process.pid}.cjs`
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
  listPs1Saves,
  readPs1SaveContents,
  buildMcsBuffer,
  importMcsIntoCard,
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
const FRAME = 128;
const BLOCK = 8192;
const CARD = BLOCK * 16; // 131072

// Write one directory frame (in block 0) for a data block.
const writeDirFrame = (card, blockIndex, { state, size, link, name }) => {
  const off = blockIndex * FRAME;
  card.writeUInt32LE(state, off + 0x00);
  card.writeUInt32LE(size, off + 0x04);
  card.writeUInt16LE(link, off + 0x08);
  Buffer.from(name, "latin1").copy(
    card,
    off + 0x0a,
    0,
    Math.min(name.length, 20)
  );
  // XOR checksum at 0x7F over bytes 0x00..0x7E (parser ignores it, set anyway).
  let xor = 0;
  for (let i = 0; i < 0x7f; i += 1) xor ^= card[off + i];
  card[off + 0x7f] = xor;
};

// Fill a data block with a recognizable byte pattern.
const fillBlock = (card, blockIndex, byte) => {
  card.fill(byte, blockIndex * BLOCK, (blockIndex + 1) * BLOCK);
};

const buildSyntheticCard = (headerBytes = 0) => {
  const card = Buffer.alloc(CARD);
  card.write("MC", 0, "latin1"); // block 0 frame 0 magic

  // Block 1: single-block save (Simpsons Hit & Run, US).
  writeDirFrame(card, 1, {
    state: 0x51,
    size: BLOCK,
    link: 0xffff,
    name: "BASLUS-20624Simp01",
  });
  fillBlock(card, 1, 0x11);

  // Blocks 2-3: a two-block save chained via the link field (block2 -> block3).
  writeDirFrame(card, 2, {
    state: 0x51,
    size: BLOCK * 2,
    link: 2, // "next block index minus one" -> block 3
    name: "BESLES-50009SAVE",
  });
  fillBlock(card, 2, 0x22);
  writeDirFrame(card, 3, { state: 0x53, size: 0, link: 0xffff, name: "" });
  fillBlock(card, 3, 0x33);

  // Block 4: a free block — must be ignored.
  writeDirFrame(card, 4, { state: 0xa0, size: 0, link: 0xffff, name: "" });

  if (headerBytes === 0) return card;
  // Prepend a wrapper header (e.g. .vmp = 128 bytes) to test offset detection.
  return Buffer.concat([Buffer.alloc(headerBytes), card]);
};

// A freshly-formatted empty card: "MC" magic + all 15 directory frames free
// (state 0xA0) with valid checksums.
const buildEmptyPs1Card = () => {
  const card = Buffer.alloc(CARD);
  card.write("MC", 0, "latin1");
  for (let b = 1; b <= 15; b += 1) {
    const base = b * FRAME;
    card.writeUInt32LE(0xa0, base);
    let xor = 0;
    for (let i = 0; i < FRAME - 1; i += 1) xor ^= card[base + i];
    card[base + FRAME - 1] = xor;
  }
  return card;
};

const writeTemp = (buf, suffix) => {
  const p = path.join(os.tmpdir(), `hydra-ps1mc-test-${process.pid}${suffix}`);
  fs.writeFileSync(p, buf);
  process.on("exit", () => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  });
  return p;
};

const runParseCase = async (headerBytes) => {
  const label = headerBytes === 0 ? "raw .mcd" : ".vmp (128-byte header)";
  console.log(`• ${label}`);
  const cardPath = writeTemp(
    buildSyntheticCard(headerBytes),
    headerBytes === 0 ? ".mcd" : ".vmp"
  );

  const info = await listPs1Saves(cardPath);
  check("  card parsed", !!info);
  if (!info) return;
  eq("  data offset", info.dataOffset, headerBytes);
  eq("  save count", info.saves.length, 2);

  const simp = info.saves.find((s) => s.identifier === "BASLUS-20624Simp01");
  check("  single-block save found", !!simp);
  if (simp) {
    eq("    sku", simp.sku, "SLUS-20624");
    eq("    blockCount", simp.blockCount, 1);
    eq("    sizeBytes", simp.sizeBytes, BLOCK);
  }

  const chained = info.saves.find((s) => s.identifier === "BESLES-50009SAVE");
  check("  chained save found", !!chained);
  if (chained) {
    eq("    sku", chained.sku, "SLES-50009");
    eq("    blockCount", chained.blockCount, 2);
  }

  // Export round-trip: header frame (128) + N blocks (8192 each).
  const contents = await readPs1SaveContents(cardPath, "BESLES-50009SAVE");
  check("  readSaveContents", !!contents);
  if (contents) {
    const mcs = buildMcsBuffer(contents);
    eq("    .mcs size", mcs.length, FRAME + BLOCK * 2);
    eq("    block 0 first byte", mcs[FRAME], 0x22);
    eq("    block 1 first byte", mcs[FRAME + BLOCK], 0x33);
  }
  console.log("");
};

// Write round-trip: export a 2-block save, import it into a fresh empty card,
// read it back, then re-import (replace) and confirm it stays a single save.
const runImportRoundTrip = async () => {
  console.log("• importMcsIntoCard (write round-trip)");
  const src = writeTemp(buildSyntheticCard(0), ".mcd");
  const srcContents = await readPs1SaveContents(src, "BESLES-50009SAVE");
  check("  source save readable", !!srcContents);
  if (!srcContents) return;

  const mcs = buildMcsBuffer(srcContents);
  const target = writeTemp(buildEmptyPs1Card(), ".mcd");

  const result = await importMcsIntoCard(target, mcs);
  check("  import ok", result.ok === true);
  if (!result.ok) console.log("    error:", result.error);

  const info = await listPs1Saves(target);
  eq("  save count", info?.saves.length, 1);
  eq("  identifier", info?.saves[0]?.identifier, "BESLES-50009SAVE");

  const back = await readPs1SaveContents(target, "BESLES-50009SAVE");
  check(
    "  blocks match",
    !!back &&
      back.blocks.length === srcContents.blocks.length &&
      srcContents.blocks.every((b, i) => b.equals(back.blocks[i]))
  );

  const r2 = await importMcsIntoCard(target, mcs);
  check("  re-import (replace) ok", r2.ok === true);
  const info2 = await listPs1Saves(target);
  eq("  one save after replace", info2?.saves.length, 1);
};

const runSelfTest = async () => {
  console.log("PS1 memory card parser — synthetic self-test\n");

  for (const headerBytes of [0, 128]) {
    await runParseCase(headerBytes);
  }

  await runImportRoundTrip();
  console.log("");

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
};

const inspectReal = async (cardPath, exportId, outPath) => {
  const info = await listPs1Saves(cardPath);
  if (!info) {
    console.error("Not a readable PS1 memory card:", cardPath);
    process.exit(1);
  }
  console.log(`Card: ${cardPath}`);
  console.log(`Data offset: ${info.dataOffset}`);
  console.log(`Saves: ${info.saves.length}\n`);
  for (const s of info.saves) {
    console.log(
      `  ${s.identifier}  sku=${s.sku ?? "—"}  blocks=${s.blockCount}  bytes=${s.sizeBytes}`
    );
  }
  if (exportId) {
    const contents = await readPs1SaveContents(cardPath, exportId);
    if (!contents) {
      console.error("\nSave not found:", exportId);
      process.exit(1);
    }
    const mcs = buildMcsBuffer(contents);
    const dest = outPath || `${exportId.replace(/[^A-Za-z0-9._-]/g, "_")}.mcs`;
    fs.writeFileSync(dest, mcs);
    console.log(`\nExported ${exportId} -> ${dest} (${mcs.length} bytes)`);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) return runSelfTest();
  const exportIdx = args.indexOf("--export");
  const cardPath = args[0];
  const exportId = exportIdx >= 0 ? args[exportIdx + 1] : null;
  const outPath = exportIdx >= 0 ? args[exportIdx + 2] : null;
  return inspectReal(cardPath, exportId, outPath);
};

main();
