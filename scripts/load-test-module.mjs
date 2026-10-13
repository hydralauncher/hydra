import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise production classes while replacing Electron-dependent imports.
export function loadTestModule(url, require, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    require,
    Buffer,
    URL,
    AbortController,
    AbortSignal,
    Error,
    TypeError,
    DOMException,
    fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals,
  });
  return exports;
}
