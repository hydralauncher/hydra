#!/usr/bin/env node
// Drive the Electron reference app over the Chrome DevTools Protocol, so the
// rewrite can be compared with it without touching the real mouse/keyboard.
//
// Start the reference with a debug port, e.g.
//   MAIN_VITE_USER_DATA_PATH=<folder> npx electron-vite preview --remoteDebuggingPort 9334
//
// Usage: node electron-cdp.mjs [--port 9334] [--target <url substring>] <command> [args]
//   list                         targets (windows) and their URLs
//   eval <js>                    evaluate JS in the page, print the JSON result
//   nav <hash>                   location.hash = <hash> (e.g. "#/library")
//   shot <file.png>              screenshot of the window (CSS pixels x DPR)
//   size <w> <h>                 resize the viewport (Emulation, no window move)
//   move <x> <y>                 mouse move (hover states)
//   click <x> <y>                mouse click
//   wheel <x> <y> <dy>           mouse wheel
//   type <text>                  insert text into the focused element
//   key <key>                    press a key (Enter, Escape, Tab, ArrowDown, …)
//   cursor <x> <y>               computed CSS cursor of the element under the point
//   cursors <selector>           cursor of every element matching selector (center points)
//   network <ms>                 log requests (method, status, url) for <ms> milliseconds
//   wait <ms>
// Several commands can be chained with " ; " in one argument.

const args = process.argv.slice(2);
let port = 9334;
let targetMatch = null;
while (args[0]?.startsWith("--")) {
  const flag = args.shift();
  if (flag === "--port") port = Number(args.shift());
  else if (flag === "--target") targetMatch = args.shift();
}

const listTargets = async () => {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await res.json()).filter((t) => t.type === "page");
};

const pickTarget = async () => {
  const targets = await listTargets();
  const match = targetMatch
    ? targets.find((t) => t.url.includes(targetMatch) || t.title.includes(targetMatch))
    : targets.find((t) => /#\/(?!achievement-notification|game-launcher|friends|chat|auth)/.test(t.url)) ??
      targets.find((t) => t.url.includes("index.html")) ??
      targets[0];
  if (!match) throw new Error("no matching target");
  return match;
};

const connect = async (target) => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, on: (fn) => listeners.push(fn) };
};

const evaluate = async (cdp, expression) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return result.result.value;
};

const cursorAt = (x, y) => `(() => {
  let el = document.elementFromPoint(${x}, ${y});
  const path = [];
  const first = el;
  while (el && el !== document.documentElement) {
    path.push(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : ""));
    el = el.parentElement;
  }
  return { cursor: first ? getComputedStyle(first).cursor : null, element: path.slice(0, 3).join(" < ") };
})()`;

const mouse = (cdp, type, x, y, extra = {}) =>
  cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });

const run = async (command, rest, cdp) => {
  switch (command) {
    case "list": {
      for (const t of await listTargets()) console.log(`${t.id}  ${t.title}  ${t.url}`);
      return;
    }
    case "eval":
      console.log(JSON.stringify(await evaluate(cdp, rest.join(" ")), null, 2));
      return;
    case "nav":
      await evaluate(cdp, `location.hash = ${JSON.stringify(rest[0])}`);
      return;
    case "size": {
      const [width, height] = rest.map(Number);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 0,
        mobile: false,
      });
      return;
    }
    case "shot": {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const fs = await import("node:fs");
      fs.writeFileSync(rest[0], Buffer.from(data, "base64"));
      console.log(`saved ${rest[0]}`);
      return;
    }
    case "move":
      await mouse(cdp, "mouseMoved", Number(rest[0]), Number(rest[1]), { button: "none" });
      return;
    case "click": {
      const [x, y] = rest.map(Number);
      await mouse(cdp, "mouseMoved", x, y, { button: "none" });
      await mouse(cdp, "mousePressed", x, y);
      await mouse(cdp, "mouseReleased", x, y);
      return;
    }
    case "wheel": {
      const [x, y, dy] = rest.map(Number);
      await mouse(cdp, "mouseWheel", x, y, { button: "none", deltaX: 0, deltaY: dy });
      return;
    }
    case "type":
      await cdp.send("Input.insertText", { text: rest.join(" ") });
      return;
    case "key": {
      const key = rest[0];
      const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8 };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0 };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key === "Enter" ? "\r" : undefined });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      return;
    }
    case "cursor":
      console.log(JSON.stringify(await evaluate(cdp, cursorAt(Number(rest[0]), Number(rest[1])))));
      return;
    case "cursors": {
      const selector = rest.join(" ");
      const list = await evaluate(
        cdp,
        `[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 50).map((el) => {
          const r = el.getBoundingClientRect();
          return { cursor: getComputedStyle(el).cursor, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40) };
        })`
      );
      for (const item of list) console.log(`${item.cursor.padEnd(12)} (${item.x},${item.y}) ${item.text}`);
      return;
    }
    case "network": {
      await cdp.send("Network.enable");
      const seen = new Map();
      cdp.on((msg) => {
        if (msg.method === "Network.requestWillBeSent") {
          seen.set(msg.params.requestId, { method: msg.params.request.method, url: msg.params.request.url });
        }
        if (msg.method === "Network.responseReceived") {
          const entry = seen.get(msg.params.requestId);
          if (entry) console.log(`${entry.method} ${msg.params.response.status} ${entry.url}`);
        }
      });
      await new Promise((r) => setTimeout(r, Number(rest[0] ?? 5000)));
      return;
    }
    case "wait":
      await new Promise((r) => setTimeout(r, Number(rest[0])));
      return;
    default:
      throw new Error(`unknown command ${command}`);
  }
};

const main = async () => {
  const script = args.join(" ");
  const steps = script.split(" ; ").map((s) => s.trim()).filter(Boolean);
  const needsPage = steps.some((s) => !s.startsWith("list"));
  const cdp = needsPage ? await connect(await pickTarget()) : null;
  if (cdp) await cdp.send("Page.enable").catch(() => {});
  for (const step of steps) {
    const [command, ...rest] = step.split(/\s+/);
    await run(command, rest, cdp);
  }
  cdp?.ws.close();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
