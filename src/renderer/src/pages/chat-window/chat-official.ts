import type {
  ChatMessagesPage,
  OfficialMessagesPage,
  UserFriend,
} from "@types";

import type { ChatConversation } from "./chat-types";
import { toChatMessage } from "./chat-state.js";

const toSvgUrl = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

// The paths of assets/icons/hydra.svg, white on a dark square.
const HYDRA_LOGO_PATHS = `
      <path d="M17.8501 29.1176L19.9196 28.3235L20.6957 25.6764L20.437 24.8823L18.1088 25.9411L14.487 24.3528L10.0891 23.0293L5.69128 23.5587L3.10431 25.6764L2.58691 29.1176L4.1391 33.6177L5.69128 36.7942L8.53695 38.9118L10.8652 38.3824L13.9696 34.9412V31.5L12.9348 29.1176V32.2941L10.8652 34.9412H7.50216L4.91519 32.2941L5.69128 28.3235L9.57174 26.4705L13.9696 27.5294L17.8501 29.1176Z"/>
      <path d="M36.9585 29.1176L34.889 28.3235L34.1129 25.6764L34.3716 24.8823L36.6998 25.9411L40.3216 24.3528L44.7195 23.0293L49.1173 23.5587L51.7043 25.6764L52.2217 29.1176L50.6695 33.6177L49.1173 36.7942L46.2716 38.9118L43.9434 38.3824L40.839 34.9412V31.5L41.8738 29.1176V32.2941L43.9434 34.9412H47.3064L49.8934 32.2941L49.1173 28.3235L45.2369 26.4705L40.839 27.5294L36.9585 29.1176Z"/>
      <path d="M40.3873 19.4005L38.8784 19.9071L38.7685 19.0593L38.5553 17.7049L39.811 14.777L41.6564 11.5721L44.483 9.44001L47.1023 9.23162L49.2244 10.9371L50.7089 14.4032L51.4925 17.1031L50.9665 19.9071L49.3381 20.8916L45.7182 20.6206L43.8957 18.6282L43.2332 16.675L44.9154 18.5142L47.5156 18.8992L49.4627 17.0344L49.5586 14.0673L47.0064 12.1987L43.7784 13.2776L41.7929 16.3293L40.3873 19.4005Z"/>
      <path d="M14.0238 19.4005L15.5327 19.9071L15.6426 19.0593L15.8559 17.7049L14.6001 14.777L12.7548 11.5721L9.92812 9.44001L7.30879 9.23162L5.18676 10.9371L3.70221 14.4032L2.91861 17.1031L3.44468 19.9071L5.07308 20.8916L8.69292 20.6206L10.5154 18.6282L11.178 16.675L9.4957 18.5142L6.89555 18.8992L4.94841 17.0344L4.8525 14.0673L7.4047 12.1987L10.6327 13.2776L12.6182 16.3293L14.0238 19.4005Z"/>
      <path d="M19.9494 36.4343L22.554 34.3372L21.9876 34.0884L20.9528 31.9707L19.9494 32.5001L17.5898 34.0884L15.3904 37.377L14.744 40.4414L15.2615 43.0885L17.0724 45.4709L20.9528 47.3238L23.6932 46.5297L25.435 44.7653L26.0028 42.9192L25.6093 39.0508L25.0919 37.7913L23.6932 37.0002L24.3158 39.105L24.3158 42.0296L22.3597 43.9181L19.9494 43.9181L18.0225 42.0296L17.4949 39.105L19.9494 36.4343Z"/>
      <path d="M35.0955 36.4343L32.4909 34.3372L33.0573 34.0884L34.0921 31.9707L35.0955 32.5001L37.4552 34.0884L39.6545 37.377L40.3009 40.4414L39.7834 43.0885L37.9725 45.4709L34.0921 47.3238L31.3518 46.5297L29.6099 44.7653L29.0421 42.9192L29.4356 39.0508L29.953 37.7913L31.3518 37.0002L30.7291 39.105L30.7291 42.0296L32.6852 43.9181L35.0955 43.9181L37.0224 42.0296L37.55 39.105L35.0955 36.4343Z"/>
      <path d="M18.8447 8.70593V5.79413L20.1382 5H22.9839L27.3817 5.79413L31.7796 5H34.6252L35.9187 5.79413V8.70593L38.7644 11.353L37.2122 15.0589L37.9883 20.8825L35.9187 23.0002L33.3317 23.7943L32.8144 26.1767L33.3317 28.8238L32.8144 30.9415L31.7796 33.0591L30.2274 33.8533H27.3817H24.536L22.9839 33.0591L21.9491 30.9415L21.4317 28.8238L21.9491 26.1767L21.4317 23.7943L18.8447 23.0002L16.7751 20.8825L17.5512 15.0589L15.999 11.353L18.8447 8.70593Z"/>
      <path d="M15.5205 6.88232L16.2966 8.73528L17.5901 7.67645V4.76465L15.5205 6.88232Z"/>
      <path d="M39.2861 6.88232L38.51 8.73528L37.2166 7.67645V4.76465L39.2861 6.88232Z"/>
      <path d="M18.3667 2.11767L18.6254 4.23534L19.4015 3.70593H20.9537L20.4363 2.11767L17.0732 0L18.3667 2.11767Z"/>
      <path d="M35.6997 2.11767L35.441 4.23534L34.6649 3.70593H33.1127L33.6301 2.11767L36.9932 0L35.6997 2.11767Z"/>
`;

const OFFICIAL_AVATAR_URL = toSvgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" fill="#1c1c1c"/>
    <g transform="translate(14 16.5) scale(0.95)" fill="#ffffff">${HYDRA_LOGO_PATHS}</g>
  </svg>`
);

export const toOfficialFriend = (
  sender: OfficialMessagesPage["sender"]
): UserFriend => ({
  id: sender.id,
  displayName: sender.displayName,
  profileImageUrl: sender.profileImageUrl ?? OFFICIAL_AVATAR_URL,
  backgroundImageUrl: null,
  currentGame: null,
  isOnline: false,
  isOfficial: true,
});

// A Cloudflare error page once reached the launcher as API data, so the shape
// is checked before it can reach the conversation list.
export const isOfficialMessagesPage = (
  value: unknown
): value is OfficialMessagesPage => {
  const page = value as Partial<OfficialMessagesPage> | null;

  return (
    typeof page === "object" &&
    page !== null &&
    Array.isArray(page.messages) &&
    typeof page.sender?.id === "string" &&
    typeof page.sender.displayName === "string" &&
    Number.isSafeInteger(page.unreadCount)
  );
};

/** The official page in the shape the chat's history loading works with. */
export const toChatMessagesPage = (
  page: OfficialMessagesPage,
  afterSeq?: number
): ChatMessagesPage => ({
  messages: page.messages
    .filter(({ seq }) => afterSeq === undefined || seq > afterSeq)
    .map(({ id, seq, senderId, body, createdAt, attachments }) => ({
      seq,
      senderId,
      body,
      clientNonce: id,
      createdAt,
      attachments,
    })),
  hasMore: afterSeq === undefined && page.hasMoreBefore,
  canSend: false,
  lastReadSeq: 0,
  unreadCount: page.unreadCount,
});

/**
 * Replaces the official conversation with the latest page; older messages
 * page in again on scroll, so retracted ones never linger. With no visible
 * messages the row goes away.
 */
export const applyOfficialPage = (
  conversations: ChatConversation[],
  page: OfficialMessagesPage,
  createConversation: (friend: UserFriend) => ChatConversation
): ChatConversation[] => {
  const others = conversations.filter(
    ({ friend }) => friend.id !== page.sender.id
  );
  if (page.messages.length === 0) return others;

  const friend = toOfficialFriend(page.sender);
  const existing = conversations.find(
    (conversation) => conversation.friend.id === page.sender.id
  );
  const messages = toChatMessagesPage(page).messages.map((message) =>
    toChatMessage(message, friend.id, true)
  );

  return [
    {
      ...(existing ?? createConversation(friend)),
      friend,
      messages,
      unreadCount: page.unreadCount,
      canSend: false,
      loadState: "loaded",
      hasMoreBefore: page.hasMoreBefore,
      isLoadingOlder: false,
      gapAfterSeq: null,
    },
    ...others,
  ];
};
