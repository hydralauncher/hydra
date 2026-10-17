import test from "node:test";
import assert from "node:assert/strict";
import {
  MODS_ERROR_CODES,
  encodeModsError,
  parseModsError,
  stripIpcErrorPrefix,
} from "./mods-errors.js";

test("round-trips a code with parameters", () => {
  const encoded = encodeModsError("package_not_found", { name: "A-ModA" });
  assert.deepEqual(parseModsError(encoded), {
    code: "package_not_found",
    params: { name: "A-ModA" },
  });
});

test("round-trips a code without parameters", () => {
  assert.deepEqual(parseModsError(encodeModsError("no_executable")), {
    code: "no_executable",
    params: {},
  });
});

test("finds the code inside Electron's IPC error wrapper", () => {
  const wrapped = `Error invoking remote method 'modsInstall': Error: ${encodeModsError("unsafe_path", { path: "../x.dll" })}`;
  assert.deepEqual(parseModsError(wrapped), {
    code: "unsafe_path",
    params: { path: "../x.dll" },
  });
});

test("ignores unknown codes, plain messages and bad parameters", () => {
  assert.equal(parseModsError("mods:definitely_not_real"), null);
  assert.equal(parseModsError("Network Error"), null);
  assert.deepEqual(parseModsError("mods:no_community|{not json}"), {
    code: "no_community",
    params: {},
  });
});

test("every code is a lowercase identifier", () => {
  for (const code of MODS_ERROR_CODES) assert.match(code, /^[a-z_]+$/);
});

test("strips the IPC wrapper from unknown errors", () => {
  assert.equal(
    stripIpcErrorPrefix(
      "Error invoking remote method 'modsSearch': Error: timeout of 120000ms exceeded"
    ),
    "timeout of 120000ms exceeded"
  );
  assert.equal(stripIpcErrorPrefix("plain"), "plain");
});
