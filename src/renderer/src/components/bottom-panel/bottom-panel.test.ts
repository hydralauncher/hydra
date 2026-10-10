import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

for (const eta of [undefined, "1s"]) {
  it(`renders compact batch progress without per-file records when ETA is ${eta}`, () => {
    const translations: { key: string; values: Record<string, unknown> }[] = [];
    const exports: { BottomPanel?: React.ComponentType } = {};
    const code = ts.transpileModule(
      fs.readFileSync(new URL("./bottom-panel.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }
    ).outputText;
    const dependencies: Record<string, unknown> = {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "react-i18next": {
        useTranslation: () => ({
          t: (key: string, values: Record<string, unknown> = {}) => {
            translations.push({ key, values });
            return key;
          },
        }),
      },
      "react-router-dom": { useNavigate: () => () => {} },
      "@primer/octicons-react": { CommentDiscussionIcon: () => null },
      "@renderer/hooks": {
        useAppSelector: () => null,
        useUserDetails: () => ({}),
        useToast: () => ({}),
        useLibrary: () => ({
          downloadLibrary: [{ id: "fixture", title: "Fixture" }],
        }),
        useDownload: () => ({
          lastPacket: {
            gameId: "fixture",
            batchFilesDownloaded: 1,
            batchFilesTotal: 3,
          },
          progress: "33%",
          downloadSpeed: "1 MB/s",
          eta,
        }),
      },
      "./bottom-panel.scss": {},
    };
    runInNewContext(code, {
      exports,
      require: (id: string) => {
        assert.ok(id in dependencies, id);
        return dependencies[id];
      },
    });
    renderToStaticMarkup(React.createElement(exports.BottomPanel!));
    const batch = translations.find(
      (item) =>
        item.key === (eta ? "downloading_batch" : "calculating_eta_batch")
    );
    assert.ok(batch);
    assert.equal(batch.values.filesDownloaded, 1);
    assert.equal(batch.values.filesTotal, 3);
  });
}
