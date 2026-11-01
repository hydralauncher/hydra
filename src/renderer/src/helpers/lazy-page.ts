import { lazy, type ComponentType } from "react";

type PageModule = { default: ComponentType };

export type LazyPage = ReturnType<typeof lazyPage>;

export function lazyPage(load: () => Promise<PageModule>) {
  return Object.assign(lazy(load), { preload: load });
}

export function preloadPagesWhenIdle(pages: LazyPage[]) {
  const queue = [...pages];

  const preloadNext = () => {
    const page = queue.shift();
    if (!page) return;

    page
      .preload()
      .catch(() => {})
      .finally(() => {
        globalThis.requestIdleCallback(preloadNext);
      });
  };

  globalThis.requestIdleCallback(preloadNext);
}
