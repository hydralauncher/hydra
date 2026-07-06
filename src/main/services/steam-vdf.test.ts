import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseVdf, getVdfValue } from "./steam-vdf.ts";

describe("parseVdf", () => {
  it("parses an appmanifest file", () => {
    const manifest = `
"AppState"
{
\t"appid"\t\t"440"
\t"name"\t\t"Team Fortress 2"
\t"StateFlags"\t\t"4"
}
`;

    const parsed = parseVdf(manifest);

    assert.equal(getVdfValue(parsed, "AppState", "appid"), "440");
    assert.equal(getVdfValue(parsed, "AppState", "name"), "Team Fortress 2");
  });

  it("parses libraryfolders.vdf with nested folder objects", () => {
    const libraryFolders = `
"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t}
}
`;

    const parsed = parseVdf(libraryFolders);

    assert.equal(
      getVdfValue(parsed, "libraryfolders", "0", "path"),
      "C:\\Program Files (x86)\\Steam"
    );
    assert.equal(
      getVdfValue(parsed, "libraryfolders", "1", "path"),
      "D:\\SteamLibrary"
    );
  });

  it("parses playtime out of a localconfig-shaped document", () => {
    const localConfig = `
"UserLocalConfigStore"
{
\t"Software"
\t{
\t\t"valve"
\t\t{
\t\t\t"Steam"
\t\t\t{
\t\t\t\t"apps"
\t\t\t\t{
\t\t\t\t\t"440"
\t\t\t\t\t{
\t\t\t\t\t\t"LastPlayed"\t\t"1700000000"
\t\t\t\t\t\t"Playtime"\t\t"124"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}
\t}
}
`;

    const parsed = parseVdf(localConfig);
    const apps = getVdfValue(
      parsed,
      "UserLocalConfigStore",
      "Software",
      "Valve",
      "Steam",
      "apps"
    );

    assert.equal(getVdfValue(apps, "440", "Playtime"), "124");
  });

  it("ignores keys with mismatched braces instead of throwing", () => {
    const malformed = '"root" { "key" "value"';

    const parsed = parseVdf(malformed);

    assert.equal(getVdfValue(parsed, "root", "key"), "value");
  });

  it("returns undefined for missing paths", () => {
    const parsed = parseVdf('"root" { "key" "value" }');

    assert.equal(getVdfValue(parsed, "root", "missing"), undefined);
    assert.equal(getVdfValue(parsed, "missing", "key"), undefined);
  });
});
