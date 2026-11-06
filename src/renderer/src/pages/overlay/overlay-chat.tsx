import { useTranslation } from "react-i18next";
import cn from "classnames";

import { ChatWindowView } from "../chat-window/chat-window-view";
import { useChatWindowController } from "../chat-window/use-chat-window-controller";

interface OverlayChatProps {
  onClose: () => void;
  showHeader?: boolean;
  className?: string;
}

export function OverlayChat({
  onClose,
  showHeader = true,
  className,
}: Readonly<OverlayChatProps>) {
  const { t } = useTranslation("overlay");
  const controller = useChatWindowController({
    playMessageSounds: false,
    syncWindowState: false,
    updateDocumentTitle: false,
    consumePendingChatFriends: false,
  });

  return (
    <div className={cn("overlay-chat", className)}>
      <ChatWindowView
        controller={controller}
        onMinimize={onClose}
        onCloseWindow={onClose}
        showWindowControls={false}
        showHeader={showHeader}
        className="overlay-chat__window"
        emptyState={
          controller.hasLoadedConversations &&
          controller.conversations.length === 0 ? (
            <p>{t("empty_friends")}</p>
          ) : null
        }
      />
    </div>
  );
}
