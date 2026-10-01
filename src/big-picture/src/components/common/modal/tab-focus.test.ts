import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { trapModalTabFocus } from "./tab-focus.js";

function createDialog() {
  const dom = new JSDOM(`
    <button id="sidebar">Sidebar</button>
    <aside role="dialog" tabindex="-1">
      <button id="close">Close</button>
      <button id="exit" data-navigation-state="active" tabindex="0">Exit</button>
      <button id="suspend" data-navigation-state="active" tabindex="-1">Suspend</button>
      <button id="restart" data-navigation-state="active" tabindex="-1">Restart</button>
      <button id="power-off" data-navigation-state="active" tabindex="-1">Power off</button>
    </aside>
  `);
  const dialog = dom.window.document.querySelector<HTMLElement>("aside")!;
  // jsdom has no layout. Model rendered controls, while preserving hidden ones.
  for (const element of dialog.querySelectorAll<HTMLElement>("*")) {
    element.getClientRects = () =>
      (element.style.display === "none" ? [] : [{}]) as unknown as DOMRectList;
  }

  const tab = (shiftKey = false) => {
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      cancelable: true,
    });
    const next = trapModalTabFocus(event, dialog);
    assert.equal(event.defaultPrevented, true);
    next.focus();
    return next.id;
  };

  return { dom, dialog, tab };
}

describe("modal Tab focus", () => {
  it("visits every power option and wraps without reaching the sidebar", () => {
    const { dom, tab } = createDialog();
    dom.window.document.getElementById("exit")!.focus();
    assert.deepEqual(
      Array.from({ length: 7 }, () => tab()),
      ["suspend", "restart", "power-off", "close", "exit", "suspend", "restart"]
    );
  });

  it("wraps Shift+Tab backwards inside the dialog", () => {
    const { dom, tab } = createDialog();
    dom.window.document.getElementById("exit")!.focus();
    assert.deepEqual(
      Array.from({ length: 6 }, () => tab(true)),
      ["close", "power-off", "restart", "suspend", "exit", "close"]
    );
  });

  it("skips disabled, hidden and loading controls", () => {
    const { dom, tab } = createDialog();
    const document = dom.window.document;
    document.getElementById("suspend")!.setAttribute("disabled", "");
    document.getElementById("restart")!.style.display = "none";
    document.getElementById("power-off")!.setAttribute("aria-disabled", "true");
    document.getElementById("exit")!.focus();
    assert.equal(tab(), "close");
    assert.equal(tab(), "exit");
  });

  it("recovers focus from the background in either direction", () => {
    const { dom, tab } = createDialog();
    dom.window.document.getElementById("sidebar")!.focus();
    assert.equal(tab(), "close");
    dom.window.document.getElementById("sidebar")!.focus();
    assert.equal(tab(true), "power-off");
  });

  it("limits a confirmation to its controls while the power menu remains open", () => {
    const { dom, dialog } = createDialog();
    const confirmation = dom.window.document.createElement("aside");
    confirmation.tabIndex = -1;
    confirmation.innerHTML = `
      <button id="cancel" data-navigation-state="active" tabindex="0">Cancel</button>
      <button id="confirm" data-navigation-state="active" tabindex="-1">Restart</button>
    `;
    dialog.after(confirmation);
    for (const button of confirmation.querySelectorAll<HTMLElement>("button")) {
      button.getClientRects = () => [{}] as unknown as DOMRectList;
    }
    confirmation.querySelector<HTMLElement>("#cancel")!.focus();
    const selected: string[] = [];
    for (let index = 0; index < 4; index++) {
      const event = new dom.window.KeyboardEvent("keydown", { key: "Tab" });
      const next = trapModalTabFocus(event, confirmation);
      next.focus();
      selected.push(next.id);
    }
    assert.deepEqual(selected, ["confirm", "cancel", "confirm", "cancel"]);
  });

  it("retains focus on the dialog when no controls are available", () => {
    const { dom, dialog, tab } = createDialog();
    dialog.replaceChildren();
    dom.window.document.getElementById("sidebar")!.focus();
    tab();
    assert.equal(dom.window.document.activeElement, dialog);
  });
});
