import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOMPILATION_PORTS,
  getRecompilationPortsForGame,
  isRecompilationPortId,
  pickRecompilationAsset,
} from "./recompilations.js";

const majorasMask = {
  shop: "launchbox",
  title: "The Legend of Zelda: Majora's Mask",
  platform: "Nintendo 64",
};

test("Majora's Mask on Nintendo 64 has two ports, most downloaded first", () => {
  const ports = getRecompilationPortsForGame(majorasMask);
  assert.deepEqual(
    ports.map((port) => port.id),
    ["2ship2harkinian", "zelda64recomp"]
  );
});

test("title matching ignores case, punctuation and curly apostrophes", () => {
  const ports = getRecompilationPortsForGame({
    ...majorasMask,
    title: "the legend of zelda - majora’s mask",
  });
  assert.equal(ports.length, 2);
});

test("other platforms, shops and games have no ports", () => {
  assert.equal(
    getRecompilationPortsForGame({ ...majorasMask, platform: "Nintendo 3DS" })
      .length,
    0
  );
  assert.equal(
    getRecompilationPortsForGame({ ...majorasMask, shop: "steam" }).length,
    0
  );
  assert.equal(
    getRecompilationPortsForGame({
      ...majorasMask,
      title: "The Legend of Zelda: Ocarina of Time",
    }).length,
    0
  );
});

test("Install picks the release file for the host", () => {
  const twoShip = RECOMPILATION_PORTS["2ship2harkinian"];
  const zelda64 = RECOMPILATION_PORTS.zelda64recomp;

  assert.equal(
    pickRecompilationAsset(twoShip, "win32", "x64")?.name,
    "2Ship-Battler-Bravo-Win64.zip"
  );
  assert.equal(
    pickRecompilationAsset(twoShip, "linux", "x64")?.name,
    "2Ship-Battler-Bravo-Linux.zip"
  );
  assert.equal(
    pickRecompilationAsset(twoShip, "darwin", "arm64")?.name,
    "2Ship-Battler-Bravo-Mac.zip"
  );
  assert.equal(pickRecompilationAsset(twoShip, "linux", "arm64"), null);

  assert.equal(
    pickRecompilationAsset(zelda64, "linux", "x64")?.name,
    "Zelda64Recompiled-v1.2.2-Linux-X64.zip"
  );
  assert.equal(
    pickRecompilationAsset(zelda64, "linux", "arm64")?.name,
    "Zelda64Recompiled-v1.2.2-Linux-ARM64.zip"
  );
  assert.equal(
    pickRecompilationAsset(zelda64, "win32", "x64")?.name,
    "Zelda64Recompiled-v1.2.2-Windows.zip"
  );
  assert.equal(
    pickRecompilationAsset(zelda64, "darwin", "x64")?.name,
    "Zelda64Recompiled-v1.2.2-macOS.zip"
  );
});

test("port ids are validated against the hardcoded list", () => {
  assert.equal(isRecompilationPortId("2ship2harkinian"), true);
  assert.equal(isRecompilationPortId("zelda64recomp"), true);
  assert.equal(isRecompilationPortId("toString"), false);
  assert.equal(isRecompilationPortId("../etc"), false);
  assert.equal(isRecompilationPortId(42), false);
});
