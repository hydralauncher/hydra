import { WindowTitleBar } from "@renderer/components";

import "./auth-window.scss";

const electron = globalThis.electron as Electron;

export default function AuthWindow() {
  return (
    <div className="auth-window">
      <WindowTitleBar
        onMinimize={() => electron.minimizeAuthWindow()}
        onClose={() => electron.closeAuthWindow()}
      />
    </div>
  );
}
