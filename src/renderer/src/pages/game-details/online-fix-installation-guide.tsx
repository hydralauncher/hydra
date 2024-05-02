import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { createPortal } from "react-dom";

export function OnlineFixInstallationGuide() {
  return (
    <Modal title="Extraction password" visible>
      <form>
        <p>
          When asked for an extraction password for OnlineFix repacks, use the
          following one:
        </p>
        <TextField value="online-fix.me" readOnly disabled />

        <CheckboxField label="Don't show it again" />

        <Button>Ok</Button>
      </form>
    </Modal>
  );
}
