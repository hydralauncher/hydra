//! chat-taskbar-badge.ts: the total unread chat count on the taskbar button
//! (Windows draws it into an overlay icon) or the dock (app.setBadgeCount).

use std::cell::Cell;

thread_local! {
    static COUNT: Cell<i64> = const { Cell::new(0) };
}

/// ChatTaskbarBadge.setCount
pub fn set_count(count: i64) {
    if COUNT.with(|c| c.replace(count)) == count {
        return;
    }
    // TODO(chat): ITaskbarList3::SetOverlayIcon with the red badge
    // (get_chat_badge_label) on every visible window, re-applied on show.
}
