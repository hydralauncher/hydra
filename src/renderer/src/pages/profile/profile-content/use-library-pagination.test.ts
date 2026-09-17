import assert from "node:assert/strict";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useLibraryPagination } from "./use-library-pagination.js";

it("fills an ultrawide library without extra scroll events and stops when exhausted", () => {
  const dom = new JSDOM('<div id="scrollableDiv"><div id="app"></div></div>');
  const observers: Array<{
    notify: (visible: boolean) => void;
    disconnected: boolean;
  }> = [];
  class MockIntersectionObserver {
    disconnected = false;
    constructor(
      private callback: IntersectionObserverCallback,
      options: IntersectionObserverInit
    ) {
      assert.equal(
        options.root,
        dom.window.document.getElementById("scrollableDiv")
      );
      observers.push(this);
    }
    observe(target: Element) {
      assert.equal(target.parentElement?.id, "app");
    }
    disconnect() {
      this.disconnected = true;
    }
    notify(visible: boolean) {
      this.callback(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
    }
  }
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IntersectionObserver: MockIntersectionObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const original = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  let requests = 0;
  const onLoadMore = () => {
    requests++;
  };
  function Harness(props: {
    itemCount: number;
    isLoading: boolean;
    enabled: boolean;
  }) {
    const ref = useLibraryPagination({ ...props, onLoadMore });
    return createElement("div", { ref });
  }
  const root = createRoot(dom.window.document.getElementById("app")!);
  const render = (itemCount: number, isLoading = false, enabled = true) => {
    act(() =>
      root.render(createElement(Harness, { itemCount, isLoading, enabled }))
    );
  };
  try {
    render(12);
    act(() => observers.at(-1)!.notify(true));
    assert.equal(requests, 1);
    act(() => observers.at(-1)!.notify(true));
    assert.equal(
      requests,
      1,
      "repeated notifications cannot duplicate requests"
    );
    render(12, true);
    assert.equal(observers.at(-1)!.disconnected, true);
    assert.equal(observers.length, 1, "no observer while a page is loading");

    render(24);
    act(() => observers.at(-1)!.notify(true));
    assert.equal(
      requests,
      2,
      "still-visible end loads another page without scrolling"
    );
    render(24, true);
    render(36);
    act(() => observers.at(-1)!.notify(false));
    assert.equal(
      requests,
      2,
      "loading stops once the grid extends past the viewport"
    );
    act(() => observers.at(-1)!.notify(true));
    assert.equal(
      requests,
      3,
      "scrolling or resizing to reveal the end resumes loading"
    );
    render(36, true);
    render(40, false, false);
    assert.equal(observers.length, 3, "exhausted libraries are not observed");
  } finally {
    act(() => root.unmount());
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
