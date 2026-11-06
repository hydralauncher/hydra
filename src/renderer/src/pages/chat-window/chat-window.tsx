import { ChatWindowView } from "./chat-window-view";
import { useChatWindowController } from "./use-chat-window-controller";

const electron = globalThis.electron as Electron;

export default function ChatWindow() {
  const controller = useChatWindowController();

  return (
    <ChatWindowView
      controller={controller}
      onMinimize={() => electron.minimizeChatWindow()}
      onCloseWindow={() => electron.closeChatWindow()}
    />
  );
}
