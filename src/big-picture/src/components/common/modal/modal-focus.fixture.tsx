import assert from "node:assert/strict";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Modal } from "./index";
import { Input } from "../input";
import { FocusItem } from "../focus-item";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { VirtualKeyboardProvider } from "../virtual-keyboard";
import { NavigationStateBridge } from "../../providers/navigation-state-bridge.provider";
import { NavigationService } from "../../../services/navigation.service";
import { NavigationItemActionsService } from "../../../services/navigation-item-actions.service";
import { useVirtualKeyboardStore } from "../../../stores/virtual-keyboard.store";

function Fixture() {
  const [value, setValue] = useState("");

  return (
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NavigationStateBridge />
      <Modal visible onClose={() => {}} title="Language selector">
        <VerticalFocusGroup regionId="fixture-group">
          <Input
            id="search-input"
            focusId="search-owner"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Search language"
          />
          <FocusItem id="action" asChild>
            <button type="button">Language option</button>
          </FocusItem>
          <output id="typed-value">{value}</output>
        </VerticalFocusGroup>
      </Modal>
      <VirtualKeyboardProvider />
    </MemoryRouter>
  );
}

async function tab(backwards = false) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: backwards,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  assert.equal(useVirtualKeyboardStore.getState().target, null);
}

export async function verifyModalFocus(
  virtualKeyboardEnabled: boolean,
  navigateBeforeActivation: boolean
) {
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<Fixture />));
    const close = document.querySelector<HTMLButtonElement>(
      ".modal__header-close-button"
    )!;
    const input = document.getElementById("search-input") as HTMLInputElement;
    const action = document.getElementById("action")!;

    close.focus();
    await tab();
    assert.equal(document.activeElement, input);
    assert.equal(
      NavigationService.getInstance().getCurrentFocusId(),
      "search-owner"
    );

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "French");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(document.getElementById("typed-value")!.textContent, "French");
    assert.equal(document.activeElement, input);

    await tab();
    assert.equal(document.activeElement, action);
    await tab(true);
    assert.equal(document.activeElement, input);
    // This is the reported failure: the next Tab must still reach the action.
    await tab();
    assert.equal(document.activeElement, action);
    await tab();
    assert.equal(document.activeElement, close);
    await tab(true);
    assert.equal(document.activeElement, action);
    await tab(true);
    assert.equal(document.activeElement, input);
    await tab(true);
    assert.equal(document.activeElement, close);

    await tab();
    if (navigateBeforeActivation) {
      await act(async () => NavigationService.getInstance().moveFocus("down"));
      assert.equal(document.activeElement, action);
      await act(async () => NavigationService.getInstance().moveFocus("up"));
      assert.equal(document.activeElement?.id, "search-owner");
    } else {
      assert.equal(document.activeElement, input);
    }
    await act(async () =>
      NavigationItemActionsService.getInstance().triggerPrimaryForFocusedItem()
    );
    if (virtualKeyboardEnabled) {
      assert.ok(
        useVirtualKeyboardStore.getState().target === input,
        "Controller activation must open the virtual keyboard for this input"
      );
      assert.ok(
        document.querySelector(
          '[data-focus-region-id="big-picture-virtual-keyboard"]'
        )
      );
    } else {
      assert.equal(useVirtualKeyboardStore.getState().target, null);
      assert.equal(document.activeElement, input);
    }
  } finally {
    await act(async () => root.unmount());
  }
}
