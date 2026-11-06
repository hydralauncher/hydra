import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";

import {
  fetchAllProfileFriends,
  OFFICIAL_MESSAGES_PATH,
  PROFILE_FRIENDS_PATH,
} from "@shared";
import type {
  ChatConversationsPage,
  OverlayChatWindowKind,
  ProfileFriends,
  UserFriend,
} from "@types";

import { applyOfficialPage, isOfficialMessagesPage } from "./chat-official";
import {
  dropAbandonedConversations,
  isOfficialAccount,
  toConversationLastMessage,
} from "./chat-sidebar-layout";
import { playMessageSound } from "./chat-sounds";
import type { ChatConversation } from "./chat-types";
import { useChat } from "./use-chat";

const electron = globalThis.electron as Electron;

const CHAT_CONVERSATIONS_PATH = "/profile/chats";
/** Largest page the API serves. */
const CHAT_CONVERSATIONS_PAGE_SIZE = 50;
/** Conversations past this many stay reachable through the picker. */
const CHAT_CONVERSATIONS_LIMIT = 200;

const createConversation = (friend: UserFriend): ChatConversation => ({
  friend,
  messages: [],
  isTyping: false,
  unreadCount: 0,
  draft: "",
  draftImages: [],
  replyToSeq: null,
  canSend: true,
  loadState: "idle",
  hasMoreBefore: false,
  isLoadingOlder: false,
  gapAfterSeq: null,
});

export interface UseChatWindowControllerOptions {
  /** The chat window plays notification sounds; the overlay must not. */
  playMessageSounds?: boolean;
  /** Only the dedicated chat window may report its state to the main process. */
  syncWindowState?: boolean;
  /** Overlay chat windows report their own state for notification checks. */
  syncOverlayWindowState?: OverlayChatWindowKind;
  /** Detached windows without a title bar still set their own title. */
  updateDocumentTitle?: boolean;
  /** Only the dedicated window should claim conversations waiting for it. */
  consumePendingChatFriends?: boolean;
}

export interface ChatWindowController {
  conversations: ChatConversation[];
  activeId: string | null;
  friends: UserFriend[];
  activeConversation: ChatConversation | null;
  hasLoadedConversations: boolean;
  chat: ReturnType<typeof useChat>;
  isKeyboardNavigating: boolean;
  openIdsRef: MutableRefObject<Set<string>>;
  preparingImagesRef: MutableRefObject<Map<string, number>>;
  refreshFriends: () => Promise<void>;
  updateConversation: (
    friendId: string,
    update: (conversation: ChatConversation) => ChatConversation
  ) => void;
  handleSelect: (friendId: string) => void;
  handleOpenConversation: (friend: UserFriend) => void;
}

export const useChatWindowController = ({
  playMessageSounds = true,
  syncWindowState = true,
  syncOverlayWindowState,
  updateDocumentTitle = true,
  consumePendingChatFriends = true,
}: UseChatWindowControllerOptions = {}): ChatWindowController => {
  const { t, i18n } = useTranslation("chat_window");

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Who the new conversation picker offers.
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);

  const listRequestIdRef = useRef(0);

  // Every conversation with messages, most recent first, so the sidebar shows
  // them all. Ones already open (from a pending open) keep their state and
  // stay first; the rest fill in behind, with their latest message and unread
  // count from the list.
  const loadConversations = useCallback(async () => {
    const requestId = ++listRequestIdRef.current;
    const listed: ChatConversationsPage["conversations"] = [];
    let cursor: string | null = null;

    try {
      do {
        const page: ChatConversationsPage =
          await electron.hydraApi.get<ChatConversationsPage>(
            CHAT_CONVERSATIONS_PATH,
            {
              params: {
                take: CHAT_CONVERSATIONS_PAGE_SIZE,
                ...(cursor ? { cursor } : {}),
              },
            }
          );
        listed.push(...page.conversations);
        cursor = page.nextCursor;
      } while (cursor && listed.length < CHAT_CONVERSATIONS_LIMIT);
    } catch {
      // The sidebar still shows whatever was opened; the next open retries.
      if (requestId === listRequestIdRef.current)
        setHasLoadedConversations(true);
      return;
    }
    if (requestId !== listRequestIdRef.current) return;
    setHasLoadedConversations(true);

    setConversations((current) => {
      const openIds = new Set(
        current.map((conversation) => conversation.friend.id)
      );
      const listedById = new Map(listed.map((dto) => [dto.friendId, dto]));

      const open = current.map((conversation) => {
        const dto = listedById.get(conversation.friend.id);
        return dto
          ? {
              ...conversation,
              // A pending open built from a notification may lack the mark.
              friend: { ...conversation.friend, ...dto.friend },
              lastMessage: toConversationLastMessage(dto),
              canSend: dto.canSend && !isOfficialAccount(dto.friend),
            }
          : conversation;
      });

      const rest = listed
        .filter((dto) => !openIds.has(dto.friendId))
        .map((dto) => ({
          ...createConversation({
            ...dto.friend,
            currentGame: null,
            backgroundImageUrl: null,
            isOnline: false,
          }),
          lastMessage: toConversationLastMessage(dto),
          unreadCount: dto.unreadCount,
          // One way, whatever the API says about the relationship.
          canSend: dto.canSend && !isOfficialAccount(dto.friend),
        }));

      return [...open, ...rest];
    });

    setActiveId((activeId) => activeId ?? listed[0]?.friendId ?? null);
  }, []);

  const officialRequestIdRef = useRef(0);
  const officialRevisionRef = useRef<number | null>(null);
  const language = i18n.language;
  const languageRef = useRef(language);

  // Official messages aren't part of the list above: older launchers read that
  // too, and they would show this as a direct conversation.
  const loadOfficialConversation = useCallback(async () => {
    const requestId = ++officialRequestIdRef.current;
    const page = await electron.hydraApi
      .get<unknown>(OFFICIAL_MESSAGES_PATH, {
        params: { language: languageRef.current },
      })
      .catch(() => null);
    if (requestId !== officialRequestIdRef.current) return;
    if (!isOfficialMessagesPage(page)) return;

    setConversations((current) =>
      applyOfficialPage(current, page, createConversation)
    );
    setActiveId((activeId) => {
      if (page.messages.length > 0) return activeId ?? page.sender.id;
      return activeId === page.sender.id ? null : activeId;
    });
  }, []);

  useEffect(() => {
    if (languageRef.current === language) return;
    languageRef.current = language;
    if (officialRevisionRef.current !== null) void loadOfficialConversation();
  }, [language, loadOfficialConversation]);

  const updateConversation = useCallback(
    (
      friendId: string,
      update: (conversation: ChatConversation) => ChatConversation
    ) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.friend.id === friendId
            ? update(conversation)
            : conversation
        )
      );
    },
    []
  );

  const chat = useChat({
    conversations,
    activeId,
    updateConversation,
    syncWindowState,
    syncOverlayWindowState,
  });

  // Images that finish preparing after their conversation closed are freed,
  // not kept.
  const openIdsRef = useRef(new Set<string>());
  const preparingImagesRef = useRef(new Map<string, number>());
  useEffect(() => {
    openIdsRef.current = new Set(
      conversations.map((conversation) => conversation.friend.id)
    );
  }, [conversations]);

  // Friend updates arrive in bursts; only the latest refresh may write, so a
  // slow, older response can't roll presence back.
  const friendsRequestIdRef = useRef(0);

  // Keeps presence and "playing" status of open conversations and the new
  // conversation picker current.
  const refreshFriends = useCallback(async () => {
    const requestId = ++friendsRequestIdRef.current;

    try {
      const response = await fetchAllProfileFriends((take, skip) =>
        electron.hydraApi.get<ProfileFriends>(PROFILE_FRIENDS_PATH, {
          params: { take, skip },
        })
      );
      if (requestId !== friendsRequestIdRef.current) return;

      setFriends(response.friends);

      const friendsById = new Map(
        response.friends.map((friend) => [friend.id, friend])
      );

      setConversations((current) =>
        current.map((conversation) => {
          const friend = friendsById.get(conversation.friend.id);
          return friend
            ? { ...conversation, friend: { ...conversation.friend, ...friend } }
            : conversation;
        })
      );
    } catch {
      // ignore transient errors; the next update will retry
    }
  }, []);

  const openPendingConversations = useCallback(async () => {
    const pending = await electron.consumePendingChatFriends();
    const last = pending.at(-1);
    if (!last) return;

    // Conversations opened in the background for a message the user hasn't
    // seen start with its unread badge.
    const unread = pending.some((entry) => entry.isBackground)
      ? await electron.getChatUnreadState().catch(() => null)
      : null;

    setConversations((current) =>
      pending.reduce((next, { friend, isBackground }) => {
        const existing = next.find(
          (conversation) => conversation.friend.id === friend.id
        );

        if (!existing) {
          return [
            {
              ...createConversation(friend),
              unreadCount: isBackground
                ? Math.max(unread?.byFriend[friend.id] ?? 0, 1)
                : 0,
            },
            ...next,
          ];
        }

        // An open conversation already counts its own unread messages.
        if (isBackground) return next;

        return next.map((conversation) =>
          conversation === existing
            ? {
                ...conversation,
                friend: { ...conversation.friend, ...friend },
                unreadCount: 0,
              }
            : conversation
        );
      }, current)
    );

    // A background open leaves the active conversation in place; it only gets
    // picked when no conversation is open yet.
    const foreground = pending.findLast((entry) => !entry.isBackground);
    setActiveId(
      (activeId) => foreground?.friend.id ?? activeId ?? last.friend.id
    );

    // The opener's copy can be stale, and one built from a message
    // notification has no presence or game at all. Realtime events only report
    // changes, so fetch the current state once.
    void refreshFriends();
  }, [refreshFriends]);

  useEffect(() => {
    if (updateDocumentTitle) document.title = t("title");
  }, [t, updateDocumentTitle]);

  // Chromium can move focus to the first conversation as the window opens,
  // ringed as if the user had tabbed there. The ring waits for a real Tab
  // press.
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Alt+Tab belongs to the OS window switcher, Ctrl+Tab to the
      // conversations.
      if (event.key === "Tab" && !event.altKey && !event.ctrlKey) {
        setIsKeyboardNavigating(true);
      }
    };
    const handlePointerDown = () => setIsKeyboardNavigating(false);

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  useEffect(() => {
    if (consumePendingChatFriends) openPendingConversations();
    void loadConversations()
      .then(async () => {
        await refreshFriends();
        await electron.refreshOfficialChat().catch(() => {});
        const unread = await electron.getChatUnreadState().catch(() => null);
        officialRevisionRef.current = unread?.officialRevision ?? 0;
        await loadOfficialConversation();
      })
      .catch(() => {});

    const unsubscribePending = consumePendingChatFriends
      ? electron.onChatFriendsPending(() => {
          openPendingConversations();
        })
      : () => undefined;
    // The main process decides when a message is worth a sound (see
    // showChatNotification); this window just plays it.
    const unsubscribeSound = playMessageSounds
      ? electron.onChatMessageSound(() => {
          void playMessageSound();
        })
      : () => undefined;
    const unsubscribeFriends = electron.onFriendsUpdated(() => {
      refreshFriends();
    });
    const unsubscribeResync = electron.onChatResync(() => {
      void loadConversations();
    });
    const unsubscribeUnread = electron.onChatUnreadUpdated(
      ({ officialRevision }) => {
        if (
          officialRevisionRef.current === null ||
          officialRevision === undefined ||
          officialRevision === officialRevisionRef.current
        ) {
          return;
        }

        officialRevisionRef.current = officialRevision;
        void loadOfficialConversation();
      }
    );
    const unsubscribePresence = electron.onFriendPresence(
      ({ friendId, isOnline }) => {
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          friend: { ...conversation.friend, isOnline },
        }));
      }
    );

    return () => {
      unsubscribePending();
      unsubscribeSound();
      unsubscribeFriends();
      unsubscribeResync();
      unsubscribeUnread();
      unsubscribePresence();
    };
  }, [
    consumePendingChatFriends,
    loadConversations,
    loadOfficialConversation,
    openPendingConversations,
    playMessageSounds,
    refreshFriends,
    updateConversation,
  ]);

  const handleSelect = (friendId: string) => {
    setActiveId(friendId);
    setConversations((current) =>
      dropAbandonedConversations(
        current,
        friendId,
        new Set(preparingImagesRef.current.keys())
      )
    );
    updateConversation(friendId, (conversation) => ({
      ...conversation,
      unreadCount: 0,
    }));
  };

  const handleOpenConversation = (friend: UserFriend) => {
    if (
      !conversations.some(
        (conversation) => conversation.friend.id === friend.id
      )
    ) {
      setConversations((current) => [createConversation(friend), ...current]);
    }

    handleSelect(friend.id);
  };

  const activeConversation =
    conversations.find((conversation) => conversation.friend.id === activeId) ??
    null;

  return {
    conversations,
    activeId,
    friends,
    activeConversation,
    hasLoadedConversations,
    chat,
    isKeyboardNavigating,
    openIdsRef,
    preparingImagesRef,
    refreshFriends,
    updateConversation,
    handleSelect,
    handleOpenConversation,
  };
};
