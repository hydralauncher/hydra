import { createRequire } from "node:module";

type JsdomModule = typeof import("jsdom");

let jsdomModule: JsdomModule | null = null;

// jsdom takes hundreds of milliseconds to load, so it is required on first use
// instead of during startup.
export const getJSDOM = () => {
  if (!jsdomModule) {
    const require = createRequire(import.meta.url);
    jsdomModule = require("jsdom") as JsdomModule;
  }

  return jsdomModule.JSDOM;
};
