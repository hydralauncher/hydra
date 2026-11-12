import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { useDownloadSourceTransferStore as store } from "./download-source-transfer.js";

describe("download source transfers across settings navigation", () => {
  beforeEach(() =>
    store.setState({ activeTransfer: null, importResult: null })
  );

  it("keeps a pending import busy after the page unsubscribes and remounts", () => {
    const firstPage = store.subscribe(() => {});
    store.getState().setActiveTransfer("import");
    firstPage();

    assert.equal(store.getState().activeTransfer, "import");
    const returnedPageStates: ("import" | "export" | null)[] = [];
    const returnedPage = store.subscribe((state) =>
      returnedPageStates.push(state.activeTransfer)
    );
    assert.equal(store.getState().activeTransfer, "import");
    store.getState().setActiveTransfer(null);
    assert.deepEqual(returnedPageStates, [null]);
    returnedPage();
  });

  it("retains an import result completed while another page was open", () => {
    store.getState().setActiveTransfer("import");
    const result = {
      imported: 2,
      skipped: 1,
      failed: ["https://example.com/unavailable"],
    };
    store.getState().setImportResult(result);
    store.getState().setActiveTransfer(null);

    assert.deepEqual(store.getState().importResult, result);
    store.getState().setImportResult(null);
    assert.equal(store.getState().importResult, null);
  });
});
