import cn from "classnames";
import type { ReactNode } from "react";

import { useFeature } from "@renderer/hooks/use-feature";

import { ChatConversationView } from "./chat-conversation";
import { ChatConversationHeader } from "./chat-conversation-header";
import { ChatSidebar } from "./chat-sidebar";
import type { ChatWindowController } from "./use-chat-window-controller";

import "./chat-window.scss";

interface ChatWindowViewProps {
  controller: ChatWindowController;
  onMinimize: () => void;
  onCloseWindow: () => void;
  showWindowControls?: boolean;
  showHeader?: boolean;
  className?: string;
  emptyState?: ReactNode;
}

export function ChatWindowView({
  controller,
  onMinimize,
  onCloseWindow,
  showWindowControls,
  showHeader = true,
  className,
  emptyState,
}: Readonly<ChatWindowViewProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  const {
    conversations,
    activeId,
    friends,
    activeConversation,
    chat,
    isKeyboardNavigating,
    openIdsRef,
    preparingImagesRef,
    refreshFriends,
    updateConversation,
    handleSelect,
    handleOpenConversation,
  } = controller;

  return (
    <div
      className={cn(
        "chat-window",
        {
          "chat-window--keyboard-navigation": isKeyboardNavigating,
        },
        className
      )}
    >
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        friends={friends}
        onRefreshFriends={() => void refreshFriends()}
        onOpenConversation={handleOpenConversation}
      />

      <section className="chat-window__pane">
        {showHeader && (
          <ChatConversationHeader
            friend={activeConversation?.friend ?? null}
            isTyping={activeConversation?.isTyping ?? false}
            onMinimize={onMinimize}
            onCloseWindow={onCloseWindow}
            showWindowControls={showWindowControls}
          />
        )}

        {!activeConversation && emptyState && (
          <div className="chat-window__empty-conversations">{emptyState}</div>
        )}

        {activeConversation && (
          <ChatConversationView
            key={activeConversation.friend.id}
            conversation={activeConversation}
            imagesEnabled={isFeatureEnabled(Feature.ChatImages)}
            sendCooldown={chat.sendCooldown}
            sendRejections={chat.sendRejections}
            onDraftChange={(draft) => {
              updateConversation(
                activeConversation.friend.id,
                (conversation) => ({
                  ...conversation,
                  draft,
                })
              );
              chat.notifyTyping(activeConversation.friend.id, draft);
            }}
            onDraftImagesChange={(update) => {
              const friendId = activeConversation.friend.id;
              if (!openIdsRef.current.has(friendId)) {
                for (const image of update([])) URL.revokeObjectURL(image.url);
                return;
              }
              updateConversation(friendId, (conversation) => ({
                ...conversation,
                draftImages: update(conversation.draftImages),
              }));
            }}
            onPreparingImagesChange={(count) => {
              const friendId = activeConversation.friend.id;
              if (count > 0) preparingImagesRef.current.set(friendId, count);
              else preparingImagesRef.current.delete(friendId);
            }}
            onReplyChange={(replyToSeq) =>
              updateConversation(
                activeConversation.friend.id,
                (conversation) => ({ ...conversation, replyToSeq })
              )
            }
            onSend={(text) => chat.send(activeConversation.friend.id, text)}
            onReact={(seq, emoji) =>
              void chat.react(activeConversation.friend.id, seq, emoji)
            }
            reactionError={
              chat.reactionError?.friendId === activeConversation.friend.id
                ? chat.reactionError.kind
                : null
            }
            onRetry={(clientNonce) =>
              chat.retry(activeConversation.friend.id, clientNonce)
            }
            onRemove={(clientNonce) =>
              chat.remove(activeConversation.friend.id, clientNonce)
            }
            onLoadOlder={() => chat.loadOlder(activeConversation.friend.id)}
            onLoadThrough={(seq) =>
              chat.loadThrough(activeConversation.friend.id, seq)
            }
            onReload={() => chat.loadLatest(activeConversation.friend.id)}
          />
        )}
      </section>
    </div>
  );
}
