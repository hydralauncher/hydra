import { createRequire } from "node:module";
import type * as JsdomModule from "jsdom";

const require = createRequire(import.meta.url);

let jsdom: typeof JsdomModule | null = null;

export const getJsdom = (): typeof JsdomModule => {
  jsdom ??= require("jsdom") as typeof JsdomModule;
  return jsdom;
};
