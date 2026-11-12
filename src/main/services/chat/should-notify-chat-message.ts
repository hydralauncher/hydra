export interface ChatMessageNotificationContext {
  notificationsEnabled: boolean;
  fromMe: boolean;
  isNewMessage: boolean;
  isOpenInFocusedChatWindow: boolean;
}

// A focused chat window with the friend's tab already open shows the message
// itself (tab dot and sound), so only messages the user cannot see notify.
export const shouldNotifyChatMessage = ({
  notificationsEnabled,
  fromMe,
  isNewMessage,
  isOpenInFocusedChatWindow,
}: ChatMessageNotificationContext) =>
  notificationsEnabled && !fromMe && isNewMessage && !isOpenInFocusedChatWindow;
