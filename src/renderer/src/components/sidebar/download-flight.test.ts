import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import type * as DownloadFlightModule from "./download-flight";

const requireModule = createRequire(import.meta.url);
const filename = "src/renderer/src/components/sidebar/download-flight.ts";
const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
  fileName: filename,
});
const loadedModule = { exports: {} as typeof DownloadFlightModule };
new Function("require", "module", "exports", outputText)(
  (specifier: string) =>
    specifier.endsWith(".scss") ? {} : requireModule(specifier),
  loadedModule,
  loadedModule.exports
);
const { getDownloadFlight, ICON_FLIGHT, SPARK_FLIGHT } = loadedModule.exports;

const BUTTON = { x: 772, y: 524 };
const DOWNLOADS_ICON = { x: 32, y: 251.5 };

const centerOf = (keyframe: Keyframe, size: number) => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    String(keyframe.transform)
  );
  assert.ok(match, `no translate in ${keyframe.transform}`);
  return { x: Number(match[1]) + size / 2, y: Number(match[2]) + size / 2 };
};

const scaleOf = (keyframe: Keyframe) =>
  Number(/scale\((-?[\d.]+)\)/.exec(String(keyframe.transform))![1]);

describe("getDownloadFlight", () => {
  const flight = getDownloadFlight(BUTTON, DOWNLOADS_ICON, ICON_FLIGHT);
  const { keyframes } = flight;
  const size = ICON_FLIGHT.size;

  it("starts hidden on the button and ends hidden on the Downloads icon", () => {
    assert.equal(keyframes[0].offset, 0);
    assert.equal(keyframes[0].opacity, 0);
    assert.deepEqual(centerOf(keyframes[0], size), BUTTON);

    const last = keyframes.at(-1)!;
    assert.equal(last.offset, 1);
    assert.equal(last.opacity, 0);
    assert.deepEqual(centerOf(last, size), DOWNLOADS_ICON);
  });

  it("keeps offsets in order", () => {
    for (let index = 1; index < keyframes.length; index++) {
      assert.ok(
        Number(keyframes[index].offset) >= Number(keyframes[index - 1].offset)
      );
    }
  });

  it("lands when the travel ends and finishes after the absorb", () => {
    assert.equal(flight.arrival, 770);
    assert.equal(flight.duration, 860);
  });

  it("pops past its lift size before it travels", () => {
    const liftScales = keyframes.slice(0, 9).map(scaleOf);
    assert.ok(Math.max(...liftScales) > ICON_FLIGHT.liftScale);
    assert.equal(liftScales.at(-1), ICON_FLIGHT.liftScale);
  });

  it("arcs above the Downloads icon before it drops in", () => {
    const highest = Math.min(
      ...keyframes.map((keyframe) => centerOf(keyframe, size).y)
    );
    assert.ok(highest < DOWNLOADS_ICON.y - 20);
  });

  it("speeds up as it drops in", () => {
    const travel = keyframes
      .slice(8, 41)
      .map((keyframe) => centerOf(keyframe, size));
    const step = (index: number) =>
      Math.hypot(
        travel[index + 1].x - travel[index].x,
        travel[index + 1].y - travel[index].y
      );

    assert.ok(step(travel.length - 2) > step(0) * 1.5);
  });

  it("is shorter for the spark", () => {
    const spark = getDownloadFlight(BUTTON, DOWNLOADS_ICON, SPARK_FLIGHT);
    assert.ok(spark.duration < flight.duration);
    assert.equal(spark.keyframes[0].opacity, 0);
  });
});
