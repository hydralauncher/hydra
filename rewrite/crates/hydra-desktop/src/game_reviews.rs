//! The reviews section of the game page (game-reviews.tsx, review-thread.tsx,
//! review-item.tsx, review-reply-item.tsx, review-reply-composer.tsx,
//! use-user-review-status.ts): the list with sort and pagination, votes,
//! submitting and deleting your own review, translations, and the reply
//! threads. API calls live in `hydra_core::reviews`; this module keeps the
//! UI state and fills the `Reviews` global.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::time::Duration;

use hydra_core::reviews::{self, Reply, Votes};
use hydra_media::images::Op;
use serde_json::Value;
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, StyledText, VecModel};

use crate::{AppWindow, Review, ReviewReply, Reviews, shell, toast};

/// review-thread.tsx VOTE_FEEDBACK_MS / game-reviews.tsx: votes stay locked
/// this long after the request settles.
const VOTE_FEEDBACK: Duration = Duration::from_millis(500);
const REVIEW_MIN_PLAYTIME_IN_MS: f64 = 60.0 * 60.0 * 1000.0;

#[derive(Default)]
struct Thread {
    replies: Vec<Reply>,
    total: i64,
    expanded: bool,
    hidden: bool,
    loading: bool,
    server_loaded: usize,
    voting: HashSet<String>,
    show_original: HashSet<String>,
    pulses: HashMap<String, (i32, i32)>,
    prefill: String,
    submitting: bool,
    model: Rc<VecModel<ReviewReply>>,
}

struct Entry {
    data: reviews::Review,
    show_original: bool,
    blocked_visible: bool,
    voting: bool,
    prev: (i64, i64),
    gens: (i32, i32),
    pulses: (i32, i32),
    thread: Thread,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    shop: String,
    object_id: String,
    /// Bumped on navigation and on every list reload, so late answers are dropped.
    generation: u64,
    list_request: u64,
    sort: String,
    page: usize,
    entries: Vec<Entry>,
    model: Rc<VecModel<Review>>,
    loading: bool,
    has_more: bool,
    user_id: Option<String>,
    /// The game's playtime for the review gate (library, or the removed record).
    play_time: f64,
    has_reviewed: bool,
    checking: bool,
    submitting: bool,
    open_composer: Option<String>,
    /// Decoded avatars and banners by URL (several reviews by one user).
    images: HashMap<String, Image>,
    pending_images: HashSet<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    /// use-user-review-status.ts reviewStatusCache: last answer per game and
    /// user, so a revisit shows the right state before the check returns.
    static STATUS_CACHE: RefCell<HashMap<String, bool>> = RefCell::new(HashMap::new());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn ui() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn md(text: &str) -> StyledText {
    StyledText::from_markdown(text).unwrap_or_else(|_| StyledText::from_plain_text(text))
}

fn rich(html: &str) -> StyledText {
    md(&hydra_store::html::rich_text_markdown(html))
}

/// helpers.ts formatNumber: compact notation, one fraction digit.
pub fn format_compact(value: i64) -> String {
    let i18n = shell::i18n();
    let number = |v: f64| {
        i18n.as_ref()
            .map(|i| i.format_number(v))
            .unwrap_or_else(|| v.to_string())
    };
    let abs = value.unsigned_abs() as f64;
    if abs < 1000.0 {
        return number(value as f64);
    }
    let (divisor, suffix) = if abs < 1e6 {
        (1e3, "K")
    } else if abs < 1e9 {
        (1e6, "M")
    } else {
        (1e9, "B")
    };
    let scaled = (value as f64 / divisor * 10.0).round() / 10.0;
    let text = if scaled.fract() == 0.0 {
        number(scaled)
    } else {
        let whole = number(scaled.trunc());
        let decimal = number(0.5).chars().nth(1).unwrap_or('.');
        format!(
            "{whole}{decimal}{}",
            ((scaled.fract().abs() * 10.0).round() as i64)
        )
    };
    format!("{text}{suffix}")
}

/// review-item.tsx formatPlayTime (seconds).
fn format_play_time(seconds: f64) -> String {
    let minutes = seconds / 60.0;
    if minutes < 120.0 {
        return shell::tr_with(
            "game_details.amount_minutes",
            &[("amount", format!("{minutes:.0}").into())],
        );
    }
    let hours = (minutes / 60.0).round();
    let amount = shell::i18n()
        .map(|i| i.format_number(hours))
        .unwrap_or_else(|| hours.to_string());
    shell::tr_with("game_details.amount_hours", &[("amount", amount.into())])
}

fn rating_text(score: i64) -> String {
    match score {
        1 => t("game_details.rating_very_negative"),
        2 => t("game_details.rating_negative"),
        3 => t("game_details.rating_neutral"),
        4 => t("game_details.rating_positive"),
        5 => t("game_details.rating_very_positive"),
        _ => String::new(),
    }
}

fn distance(created_at: &str) -> String {
    hydra_core::library::parse_iso_millis(created_at)
        .map(|at| hydra_i18n::date::format_distance(&language(), at, now_ms(), true))
        .unwrap_or_default()
}

fn translated_from(detected: Option<&str>) -> String {
    shell::tr_with(
        "game_details.show_original_translated_from",
        &[(
            "language",
            hydra_i18n::names::language_display_name(detected, &language()).into(),
        )],
    )
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.sort = "newest".into();
    });
    let model = with(|s| s.model.clone());
    let reviews = ui.global::<Reviews>();
    reviews.set_list(ModelRc::from(model));
    reviews.on_sort_changed(change_sort);
    reviews.on_load_more(load_more);
    reviews.on_submit(|text, score| submit(text.to_string(), score));
    reviews.on_vote(|id, up| vote(id.to_string(), up));
    reviews.on_delete(|id| delete(id.to_string()));
    reviews.on_toggle_original(|id| {
        update_entry(&id, |e| e.show_original = !e.show_original);
    });
    reviews.on_toggle_blocked(|id| {
        update_entry(&id, |e| e.blocked_visible = !e.blocked_visible);
    });
    reviews.on_open_profile(|id| {
        if !id.is_empty() {
            crate::nav::navigate(&format!("/profile/{id}"));
        }
    });
    reviews.on_reply_to(|id| reply_to(id.to_string()));
    reviews.on_reply_cancel(|id| {
        with(|s| s.open_composer = None);
        update_entry(&id, |e| e.thread.prefill.clear());
    });
    reviews.on_reply_submit(|id, text| post_reply(id.to_string(), text.to_string()));
    reviews.on_replies_expand(|id| fetch_replies(id.to_string(), true));
    reviews.on_replies_load_more(|id| fetch_replies(id.to_string(), false));
    reviews.on_replies_hide(|id| hide_replies(&id));
    reviews.on_replies_toggle(|id| {
        let hidden = with(|s| {
            s.entries
                .iter()
                .find(|e| e.data.id == id.as_str())
                .map(|e| (e.thread.hidden, e.thread.loading))
        });
        match hidden {
            Some((_, true)) | None => {}
            Some((true, false)) => fetch_replies(id.to_string(), true),
            Some((false, false)) => hide_replies(&id),
        }
    });
    reviews
        .on_reply_vote(|review, answer, up| vote_reply(review.to_string(), answer.to_string(), up));
    reviews.on_reply_delete(|review, answer| delete_reply(review.to_string(), answer.to_string()));
    reviews.on_reply_toggle_original(|review, answer| {
        update_entry(&review, |e| {
            if !e.thread.show_original.remove(answer.as_str()) {
                e.thread.show_original.insert(answer.to_string());
            }
        });
    });
}

/// The game page opened `/game/:shop/:objectId` (custom games have no reviews).
pub fn open(shop: &str, object_id: &str) {
    let user_id = shell::user_details()
        .and_then(|u| u.get("id").and_then(Value::as_str).map(str::to_string))
        .filter(|_| shell::signed_in());
    let generation = with(|s| {
        s.generation += 1;
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.sort = "newest".into();
        s.page = 0;
        s.entries.clear();
        s.model.set_vec(Vec::new());
        s.loading = false;
        s.has_more = true;
        s.user_id = user_id.clone();
        s.submitting = false;
        s.open_composer = None;
        s.images.clear();
        s.pending_images.clear();
        s.generation
    });
    if let Some(ui) = ui() {
        let r = ui.global::<Reviews>();
        r.set_sort("newest".into());
        r.set_total(0);
        r.set_submitting(false);
        r.set_signed_in(user_id.is_some());
    }
    if shop == "custom" || object_id.is_empty() {
        return;
    }
    refresh_playtime();
    check_status(shop, object_id, user_id.as_deref(), generation);
    load_reviews(true);
}

/// Leaving the game page.
pub fn close() {
    with(|s| {
        s.generation += 1;
        s.entries.clear();
        s.model.set_vec(Vec::new());
        s.images.clear();
        s.pending_images.clear();
    });
}

/// The library changed (playtime, added/removed): the review gate follows.
pub fn refresh_playtime() {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    if shop.is_empty() {
        return;
    }
    let play_time = match shell::find_library_game(&shop, &object_id) {
        Some(group) => group.game.displayed_play_time(),
        // getGameReviewPlaytime: the record even after it left the library.
        None => shell::db()
            .and_then(|db| {
                db.get_in::<serde_json::Map<String, Value>>(
                    hydra_db::keys::GAMES,
                    &hydra_db::keys::game(&shop, &object_id),
                )
            })
            .map(|record| hydra_core::library::LibraryGame(record).displayed_play_time())
            .unwrap_or(0.0),
    };
    with(|s| s.play_time = play_time);
    apply_gate();
}

/// isReviewLocked / canReply follow the playtime and the review status.
fn apply_gate() {
    let Some(ui) = ui() else { return };
    let (signed_in, enough, has_reviewed, checking) = with(|s| {
        (
            s.user_id.is_some(),
            s.play_time >= REVIEW_MIN_PLAYTIME_IN_MS,
            s.has_reviewed,
            s.checking,
        )
    });
    let r = ui.global::<Reviews>();
    r.set_locked(!signed_in || !enough);
    r.set_has_reviewed(has_reviewed);
    r.set_checking(checking);
    rebuild_rows();
}

fn status_identity(shop: &str, object_id: &str, user_id: Option<&str>) -> String {
    format!("{shop}:{object_id}:{}:", user_id.unwrap_or_default())
}

/// useUserReviewStatus: `/reviews/check` for signed-in users.
fn check_status(shop: &str, object_id: &str, user_id: Option<&str>, generation: u64) {
    let Some(user_id) = user_id else {
        with(|s| {
            s.has_reviewed = false;
            s.checking = false;
        });
        apply_gate();
        return;
    };
    let identity = status_identity(shop, object_id, Some(user_id));
    let cached = STATUS_CACHE.with(|c| c.borrow().get(&identity).copied());
    with(|s| {
        s.has_reviewed = cached.unwrap_or(false);
        s.checking = cached.is_none();
    });
    apply_gate();
    let Some(api) = shell::api() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let result = reviews::has_reviewed(&api, &shop, &object_id);
        let _ = slint::invoke_from_event_loop(move || {
            let has_reviewed = match result {
                Ok(value) => {
                    STATUS_CACHE.with(|c| c.borrow_mut().insert(identity, value));
                    value
                }
                Err(error) => {
                    eprintln!("Failed to check user review: {error}");
                    false
                }
            };
            if with(|s| s.generation) != generation {
                return;
            }
            set_has_reviewed(has_reviewed);
        });
    });
}

/// updateHasUserReviewed
fn set_has_reviewed(value: bool) {
    let (shop, object_id, user_id) =
        with(|s| (s.shop.clone(), s.object_id.clone(), s.user_id.clone()));
    STATUS_CACHE.with(|c| {
        c.borrow_mut().insert(
            status_identity(&shop, &object_id, user_id.as_deref()),
            value,
        )
    });
    with(|s| {
        s.has_reviewed = value;
        s.checking = false;
    });
    apply_gate();
    crate::game_page::on_review_status(value);
}

/// The review status for the review prompt: None while the check runs.
pub fn review_status() -> Option<bool> {
    with(|s| (!s.checking).then_some(s.has_reviewed))
}

/// loadReviews(reset): GET /reviews?take=20&skip=&sortBy= (a newer request
/// supersedes an older one, like the AbortController).
fn load_reviews(reset: bool) {
    let Some(api) = shell::api() else { return };
    let (shop, object_id, sort, skip, request, generation) = with(|s| {
        s.list_request += 1;
        s.loading = true;
        let skip = if reset {
            0
        } else {
            s.page * reviews::REVIEWS_PAGE_SIZE
        };
        (
            s.shop.clone(),
            s.object_id.clone(),
            s.sort.clone(),
            skip,
            s.list_request,
            s.generation,
        )
    });
    if let Some(ui) = ui() {
        ui.global::<Reviews>().set_loading(true);
    }
    std::thread::spawn(move || {
        let result = reviews::fetch_reviews(&api, &shop, &object_id, skip, &sort);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.list_request != request || s.generation != generation) {
                return;
            }
            match result {
                Ok(page) => apply_page(page, reset),
                Err(error) => eprintln!("Failed to load reviews: {error}"),
            }
            with(|s| s.loading = false);
            if let Some(ui) = ui() {
                ui.global::<Reviews>().set_loading(false);
            }
        });
    });
}

fn new_entry(data: reviews::Review) -> Entry {
    let thread = Thread {
        replies: data.answers.clone(),
        total: data.answer_count,
        model: Rc::new(VecModel::default()),
        ..Default::default()
    };
    Entry {
        prev: (data.votes.upvotes, data.votes.downvotes),
        data,
        show_original: false,
        blocked_visible: false,
        voting: false,
        gens: (0, 0),
        pulses: (0, 0),
        thread,
    }
}

fn apply_page(page: reviews::ReviewPage, reset: bool) {
    let count = page.reviews.len();
    let fresh: Vec<Entry> = page.reviews.into_iter().map(new_entry).collect();
    with(|s| {
        if reset {
            s.entries = fresh;
            s.page = 0;
        } else {
            for entry in fresh {
                if !s.entries.iter().any(|e| e.data.id == entry.data.id) {
                    s.entries.push(entry);
                }
            }
        }
        s.has_more = count == reviews::REVIEWS_PAGE_SIZE;
    });
    if let Some(ui) = ui() {
        let r = ui.global::<Reviews>();
        if reset {
            r.set_total(page.total_count as i32);
        }
        r.set_has_more(with(|s| s.has_more));
    }
    let rows: Vec<Review> = with(|s| {
        let user = s.user_id.clone();
        s.entries
            .iter()
            .map(|e| to_row(e, user.as_deref(), s))
            .collect()
    });
    with(|s| s.model.set_vec(rows));
    load_images();
}

fn change_sort(sort: SharedString) {
    let changed = with(|s| {
        if s.sort == sort.as_str() {
            return false;
        }
        s.sort = sort.to_string();
        s.page = 0;
        s.has_more = true;
        true
    });
    if !changed {
        return;
    }
    if let Some(ui) = ui() {
        ui.global::<Reviews>().set_sort(sort);
    }
    load_reviews(true);
}

/// loadMoreReviews
fn load_more() {
    let go = with(|s| {
        if s.loading || !s.has_more {
            return false;
        }
        s.page += 1;
        true
    });
    if go {
        load_reviews(false);
    }
}

/// Builds the Slint row for one review and its thread.
fn to_row(entry: &Entry, user_id: Option<&str>, s: &State) -> Review {
    let data = &entry.data;
    let own = user_id.is_some_and(|id| id == data.user.id);
    let lang = language();
    let translation = reviews::translation(
        &data.translations,
        data.detected_language.as_deref(),
        &lang,
        own,
    );
    let thread = &entry.thread;
    let blocked_collapsed = data.is_blocked && !entry.blocked_visible;
    let composer_open = s.open_composer.as_deref() == Some(data.id.as_str());
    let has_replies = !thread.replies.is_empty();
    let shown = if thread.hidden {
        0
    } else if thread.expanded {
        thread.replies.len()
    } else {
        thread.replies.len().min(reviews::REPLIES_PREVIEW_LIMIT)
    };
    let effective_total = thread.total.max(thread.replies.len() as i64);
    let enough = s.play_time >= REVIEW_MIN_PLAYTIME_IN_MS;
    let image = |url: &Option<String>| {
        url.as_ref()
            .and_then(|u| s.images.get(u))
            .cloned()
            .unwrap_or_default()
    };
    Review {
        id: data.id.clone().into(),
        user_id: data.user.id.clone().into(),
        name: if data.user.display_name.is_empty() {
            "Anonymous".into()
        } else {
            data.user.display_name.clone().into()
        },
        avatar: image(&data.user.profile_image_url),
        banner: image(
            &data
                .user
                .background_image_url
                .as_ref()
                .map(|u| banner_key(u)),
        ),
        score: data.score as i32,
        rating_text: rating_text(data.score).into(),
        playtime: data
            .play_time_in_seconds
            .filter(|s| *s > 0.0)
            .map(format_play_time)
            .unwrap_or_default()
            .into(),
        recompilation: data
            .recompilation_name
            .as_ref()
            .filter(|_| crate::features::enabled("RECOMPILATIONS"))
            .map(|name| {
                shell::tr_with(
                    "game_details.review_played_with",
                    &[("name", name.clone().into())],
                )
            })
            .unwrap_or_default()
            .into(),
        date: distance(&data.created_at).into(),
        content: rich(translation.unwrap_or(&data.html)),
        original: if translation.is_some() {
            rich(&data.html)
        } else {
            StyledText::default()
        },
        translated_from: if translation.is_some() {
            translated_from(data.detected_language.as_deref()).into()
        } else {
            SharedString::default()
        },
        show_original: entry.show_original,
        own,
        blocked: data.is_blocked,
        blocked_visible: entry.blocked_visible,
        upvotes: data.votes.upvotes as i32,
        downvotes: data.votes.downvotes as i32,
        prev_upvotes: entry.prev.0 as i32,
        prev_downvotes: entry.prev.1 as i32,
        up_label: format_compact(data.votes.upvotes).into(),
        down_label: format_compact(data.votes.downvotes).into(),
        prev_up_label: format_compact(entry.prev.0).into(),
        prev_down_label: format_compact(entry.prev.1).into(),
        has_upvoted: data.votes.has_upvoted,
        has_downvoted: data.votes.has_downvoted,
        voting: entry.voting,
        up_gen: entry.gens.0,
        down_gen: entry.gens.1,
        up_pulse: entry.pulses.0,
        down_pulse: entry.pulses.1,
        replies: ModelRc::from(thread.model.clone()),
        reply_total: effective_total as i32,
        has_replies,
        replies_loading: thread.loading,
        can_view_all: !thread.expanded && has_replies && (shown as i64) < effective_total,
        can_load_more: !thread.hidden
            && thread.expanded
            && (thread.replies.len() as i64) < thread.total,
        show_hide: !thread.hidden && has_replies,
        replies_hidden: thread.hidden,
        show_inline_reply: user_id.is_some() && !blocked_collapsed && !composer_open,
        can_reply: user_id.is_some() && (enough || s.has_reviewed),
        composer_open,
        composer_prefill: thread.prefill.clone().into(),
        reply_submitting: thread.submitting,
    }
}

fn reply_row(reply: &Reply, thread: &Thread, user_id: Option<&str>, s: &State) -> ReviewReply {
    let own = user_id.is_some_and(|id| id == reply.user.id);
    let lang = language();
    // review-reply-item.tsx: a different base language and a translation.
    let translation = reviews::translation(
        &reply.translations,
        reply.detected_language.as_deref(),
        &lang,
        own,
    );
    let (up_pulse, down_pulse) = thread.pulses.get(&reply.id).copied().unwrap_or_default();
    let image = |url: Option<String>| {
        url.and_then(|u| s.images.get(&u).cloned())
            .unwrap_or_default()
    };
    ReviewReply {
        id: reply.id.clone().into(),
        user_id: reply.user.id.clone().into(),
        name: if reply.user.display_name.is_empty() {
            "Anonymous".into()
        } else {
            reply.user.display_name.clone().into()
        },
        avatar: image(reply.user.profile_image_url.clone()),
        banner: image(reply.user.background_image_url.as_deref().map(banner_key)),
        date: distance(&reply.created_at).into(),
        content: rich(translation.unwrap_or(&reply.html)),
        original: if translation.is_some() {
            rich(&reply.html)
        } else {
            StyledText::default()
        },
        translated_from: if translation.is_some() {
            translated_from(reply.detected_language.as_deref()).into()
        } else {
            SharedString::default()
        },
        show_original: thread.show_original.contains(&reply.id),
        own,
        upvotes: format_compact(reply.votes.upvotes).into(),
        downvotes: format_compact(reply.votes.downvotes).into(),
        has_upvoted: reply.votes.has_upvoted,
        has_downvoted: reply.votes.has_downvoted,
        voting: thread.voting.contains(&reply.id),
        up_pulse,
        down_pulse,
    }
}

/// The replies on screen: all when expanded, the first five otherwise,
/// none when hidden.
fn displayed(thread: &Thread) -> &[Reply] {
    if thread.hidden {
        &[]
    } else if thread.expanded {
        &thread.replies
    } else {
        &thread.replies[..thread.replies.len().min(reviews::REPLIES_PREVIEW_LIMIT)]
    }
}

/// Re-syncs one review's replies model: rows in place when the same replies
/// are on screen (keeps the vote pulse running), a new list otherwise.
fn sync_replies(entry: &Entry, user_id: Option<&str>, s: &State) {
    let shown = displayed(&entry.thread);
    let model = &entry.thread.model;
    let same = model.row_count() == shown.len()
        && shown
            .iter()
            .enumerate()
            .all(|(i, r)| model.row_data(i).is_some_and(|row| row.id == r.id.as_str()));
    if same {
        for (i, reply) in shown.iter().enumerate() {
            model.set_row_data(i, reply_row(reply, &entry.thread, user_id, s));
        }
    } else {
        model.set_vec(
            shown
                .iter()
                .map(|r| reply_row(r, &entry.thread, user_id, s))
                .collect::<Vec<_>>(),
        );
    }
}

/// Every row again (sign-in state, gate, images), in place.
fn rebuild_rows() {
    with(|s| {
        let user = s.user_id.clone();
        for (i, entry) in s.entries.iter().enumerate() {
            sync_replies(entry, user.as_deref(), s);
            if i < s.model.row_count() {
                s.model.set_row_data(i, to_row(entry, user.as_deref(), s));
            }
        }
    });
}

/// Applies `f` to one review and refreshes its row (and its replies).
fn update_entry(id: &str, f: impl FnOnce(&mut Entry)) {
    with(|s| {
        let Some(index) = s.entries.iter().position(|e| e.data.id == id) else {
            return;
        };
        f(&mut s.entries[index]);
        let user = s.user_id.clone();
        let entry = &s.entries[index];
        sync_replies(entry, user.as_deref(), s);
        if index < s.model.row_count() {
            s.model
                .set_row_data(index, to_row(entry, user.as_deref(), s));
        }
    });
}

/// The processed banner (960x140 cover) is keyed apart from the same URL
/// used as an avatar.
fn banner_key(url: &str) -> String {
    format!("banner:{url}")
}

/// Loads the avatars and banners the rows need, once per URL.
fn load_images() {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let jobs: Vec<(String, String, Op)> = with(|s| {
        let mut jobs = Vec::new();
        let mut want = |key: String, url: String, op: Op, s: &mut State| {
            if !s.images.contains_key(&key) && s.pending_images.insert(key.clone()) {
                jobs.push((key, url, op));
            }
        };
        let users: Vec<_> = s
            .entries
            .iter()
            .flat_map(|e| {
                std::iter::once(e.data.user.clone())
                    .chain(e.thread.replies.iter().map(|r| r.user.clone()))
            })
            .collect();
        for user in users {
            if let Some(url) = user.profile_image_url {
                want(
                    url.clone(),
                    url,
                    Op::MaxWidth((56.0 * scale).ceil() as u32),
                    s,
                );
            }
            if let Some(url) = user.background_image_url {
                want(banner_key(&url), url, Op::MaxWidth(960), s);
            }
        }
        jobs
    });
    let generation = with(|s| s.generation);
    for (key, url, op) in jobs {
        loader.load(url, op, move |img| {
            if with(|s| s.generation) != generation {
                return;
            }
            with(|s| {
                s.pending_images.remove(&key);
                s.images.insert(key.clone(), img);
            });
            refresh_rows_using(&key);
        });
    }
}

/// An image arrived: refresh the reviews/replies that show it.
fn refresh_rows_using(key: &str) {
    with(|s| {
        let user = s.user_id.clone();
        for (i, entry) in s.entries.iter().enumerate() {
            let uses = |u: &reviews::Author| {
                u.profile_image_url.as_deref() == Some(key)
                    || u.background_image_url.as_deref().map(banner_key).as_deref() == Some(key)
            };
            if entry.thread.replies.iter().any(|r| uses(&r.user)) {
                sync_replies(entry, user.as_deref(), s);
            }
            if uses(&entry.data.user) && i < s.model.row_count() {
                s.model.set_row_data(i, to_row(entry, user.as_deref(), s));
            }
        }
    });
}

/// handleVoteReview: optimistic, rolled back on failure, locked for 500ms
/// after the request.
fn vote(id: String, up: bool) {
    let Some(api) = shell::api() else { return };
    if !shell::signed_in() {
        // hydraApi.put needs auth: the request fails and the vote rolls back.
        toast::error(&t("game_details.vote_failed"));
        return;
    }
    let Some((original, shop, object_id)) = with(|s| {
        let entry = s.entries.iter().find(|e| e.data.id == id)?;
        (!entry.voting).then(|| {
            (
                entry.data.votes.clone(),
                s.shop.clone(),
                s.object_id.clone(),
            )
        })
    }) else {
        return;
    };
    let next = reviews::toggle_review_vote(&original, up);
    update_entry(&id, |e| {
        e.voting = true;
        apply_votes(e, next);
    });
    let generation = with(|s| s.generation);
    std::thread::spawn(move || {
        let result = reviews::vote_review(&api, &shop, &object_id, &id, up);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            if let Err(error) = result {
                eprintln!("Failed to {} review: {error}", reviews::vote_kind(up));
                update_entry(&id, |e| apply_votes(e, original));
                toast::error(&t("game_details.vote_failed"));
            }
            slint::Timer::single_shot(VOTE_FEEDBACK, move || {
                if with(|s| s.generation) == generation {
                    update_entry(&id, |e| e.voting = false);
                }
            });
        });
    });
}

/// New vote counts: the changed count rolls from its previous value, and a
/// vote turning on pulses its button.
fn apply_votes(entry: &mut Entry, next: Votes) {
    let current = &entry.data.votes;
    if next.upvotes != current.upvotes {
        entry.prev.0 = current.upvotes;
        entry.gens.0 += 1;
    }
    if next.downvotes != current.downvotes {
        entry.prev.1 = current.downvotes;
        entry.gens.1 += 1;
    }
    if next.has_upvoted && !current.has_upvoted {
        entry.pulses.0 += 1;
    }
    if next.has_downvoted && !current.has_downvoted {
        entry.pulses.1 += 1;
    }
    entry.data.votes = next;
}

/// handleDeleteReview (no confirmation, like the renderer).
fn delete(id: String) {
    let Some(api) = shell::api() else { return };
    let (shop, object_id, generation) =
        with(|s| (s.shop.clone(), s.object_id.clone(), s.generation));
    std::thread::spawn(move || {
        let result = reviews::delete_review(&api, &shop, &object_id, &id);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(_) => {
                    load_reviews(true);
                    set_has_reviewed(false);
                    toast::success(&t("game_details.review_deleted_successfully"));
                }
                Err(error) => {
                    eprintln!("Failed to delete review: {error}");
                    toast::error(&t("game_details.review_deletion_failed"));
                }
            }
        });
    });
}

/// handleSubmitReview: POST the editor's HTML and score.
fn submit(text: String, score: i32) {
    let locked = with(|s| s.user_id.is_none() || s.play_time < REVIEW_MIN_PLAYTIME_IN_MS);
    if locked {
        return;
    }
    if crate::format::plain(&text).trim().is_empty() {
        toast::error(&t("game_details.review_cannot_be_empty"));
        return;
    }
    if with(|s| s.submitting)
        || crate::format::plain(&text).chars().count() > reviews::MAX_CHARS
        || score <= 0
    {
        return;
    }
    let Some(api) = shell::api() else { return };
    with(|s| s.submitting = true);
    if let Some(ui) = ui() {
        ui.global::<Reviews>().set_submitting(true);
    }
    let html = crate::format::to_html(&text);
    let (shop, object_id, generation) =
        with(|s| (s.shop.clone(), s.object_id.clone(), s.generation));
    std::thread::spawn(move || {
        let result = reviews::submit_review(&api, &shop, &object_id, &html, score as i64);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) == generation {
                match result {
                    Ok(_) => {
                        toast::success(&t("game_details.review_submitted_successfully"));
                        if let Some(ui) = ui() {
                            let r = ui.global::<Reviews>();
                            r.set_form_reset(r.get_form_reset() + 1);
                        }
                        load_reviews(true);
                        set_has_reviewed(true);
                    }
                    Err(error) => {
                        eprintln!("Failed to submit review: {error}");
                        toast::error(&t("game_details.review_submission_failed"));
                    }
                }
            }
            with(|s| s.submitting = false);
            if let Some(ui) = ui() {
                ui.global::<Reviews>().set_submitting(false);
            }
        });
    });
}

/// handleReplyTo(""): one composer open at a time.
fn reply_to(id: String) {
    let can_reply = with(|s| {
        s.user_id.is_some() && (s.play_time >= REVIEW_MIN_PLAYTIME_IN_MS || s.has_reviewed)
    });
    if !can_reply {
        return;
    }
    let previous = with(|s| s.open_composer.replace(id.clone()));
    if let Some(previous) = previous.filter(|p| *p != id) {
        update_entry(&previous, |e| e.thread.prefill.clear());
    }
    update_entry(&id, |e| e.thread.prefill.clear());
}

/// fetchReplies(skip, replace)
fn fetch_replies(id: String, replace: bool) {
    let Some(api) = shell::api() else { return };
    let Some((shop, object_id, skip, generation)) = with(|s| {
        let entry = s.entries.iter().find(|e| e.data.id == id)?;
        if entry.thread.loading {
            return None;
        }
        Some((
            s.shop.clone(),
            s.object_id.clone(),
            if replace {
                0
            } else {
                entry.thread.server_loaded
            },
            s.generation,
        ))
    }) else {
        return;
    };
    update_entry(&id, |e| {
        e.thread.loading = true;
        if replace {
            e.thread.hidden = false;
        }
    });
    std::thread::spawn(move || {
        let result = reviews::fetch_replies(&api, &shop, &object_id, &id, skip);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(page) => {
                    let fetched = page.answers.len();
                    update_entry(&id, |e| {
                        let t = &mut e.thread;
                        if let Some(total) = page.total_count {
                            t.total = total;
                        }
                        t.replies = if replace {
                            page.answers
                        } else {
                            reviews::merge_replies(&t.replies, page.answers)
                        };
                        t.server_loaded = if replace {
                            fetched
                        } else {
                            t.server_loaded + fetched
                        };
                        t.expanded = true;
                        t.loading = false;
                    });
                    load_images();
                }
                Err(error) => {
                    eprintln!("Failed to load replies: {error}");
                    update_entry(&id, |e| e.thread.loading = false);
                    toast::error(&t("game_details.replies_load_failed"));
                }
            }
        });
    });
}

/// handleHide
fn hide_replies(id: &str) {
    update_entry(id, |e| {
        e.thread.hidden = true;
        e.thread.expanded = false;
    });
}

/// handleVoteReply: optimistic, then the server's counts.
fn vote_reply(review_id: String, answer_id: String, up: bool) {
    let Some(api) = shell::api() else { return };
    let Some((original, shop, object_id)) = with(|s| {
        s.user_id.as_ref()?;
        let entry = s.entries.iter().find(|e| e.data.id == review_id)?;
        if entry.thread.voting.contains(&answer_id) {
            return None;
        }
        let reply = entry.thread.replies.iter().find(|r| r.id == answer_id)?;
        Some((reply.votes.clone(), s.shop.clone(), s.object_id.clone()))
    }) else {
        return;
    };
    let next = reviews::toggle_reply_vote(&original, up);
    update_entry(&review_id, |e| {
        e.thread.voting.insert(answer_id.clone());
        set_reply_votes(&mut e.thread, &answer_id, next);
    });
    let generation = with(|s| s.generation);
    std::thread::spawn(move || {
        let result = reviews::vote_reply(&api, &shop, &object_id, &review_id, &answer_id, up);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(Some((upvotes, downvotes))) => update_entry(&review_id, |e| {
                    if let Some(reply) = e.thread.replies.iter_mut().find(|r| r.id == answer_id) {
                        reply.votes.upvotes = upvotes;
                        reply.votes.downvotes = downvotes;
                    }
                }),
                Ok(None) => {}
                Err(error) => {
                    eprintln!("Failed to {} reply: {error}", reviews::vote_kind(up));
                    update_entry(&review_id, |e| {
                        set_reply_votes(&mut e.thread, &answer_id, original)
                    });
                    toast::error(&t("game_details.vote_failed"));
                }
            }
            slint::Timer::single_shot(VOTE_FEEDBACK, move || {
                if with(|s| s.generation) == generation {
                    update_entry(&review_id, |e| {
                        e.thread.voting.remove(&answer_id);
                    });
                }
            });
        });
    });
}

fn set_reply_votes(thread: &mut Thread, answer_id: &str, next: Votes) {
    let Some(reply) = thread.replies.iter_mut().find(|r| r.id == answer_id) else {
        return;
    };
    let pulses = thread.pulses.entry(answer_id.to_string()).or_default();
    if next.has_upvoted && !reply.votes.has_upvoted {
        pulses.0 += 1;
    }
    if next.has_downvoted && !reply.votes.has_downvoted {
        pulses.1 += 1;
    }
    reply.votes = next;
}

/// handleDeleteReply
fn delete_reply(review_id: String, answer_id: String) {
    let Some(api) = shell::api() else { return };
    let (shop, object_id, generation) =
        with(|s| (s.shop.clone(), s.object_id.clone(), s.generation));
    std::thread::spawn(move || {
        let result = reviews::delete_reply(&api, &shop, &object_id, &review_id, &answer_id);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(_) => {
                    update_entry(&review_id, |e| {
                        let t = &mut e.thread;
                        t.replies.retain(|r| r.id != answer_id);
                        t.total = (t.total - 1).max(0);
                        t.server_loaded = t.server_loaded.saturating_sub(1);
                    });
                    toast::success(&t("game_details.reply_deleted_successfully"));
                }
                Err(error) => {
                    eprintln!("Failed to delete reply: {error}");
                    toast::error(&t("game_details.reply_deletion_failed"));
                }
            }
        });
    });
}

/// handlePostReply: POST, close the composer, then fetch the replies after
/// the ones already counted.
fn post_reply(review_id: String, text: String) {
    if crate::format::plain(&text).trim().is_empty() {
        toast::error(&t("game_details.reply_cannot_be_empty"));
        return;
    }
    let Some(api) = shell::api() else { return };
    let can_reply = with(|s| {
        s.user_id.is_some() && (s.play_time >= REVIEW_MIN_PLAYTIME_IN_MS || s.has_reviewed)
    });
    let Some((shop, object_id, total, generation)) = with(|s| {
        let entry = s.entries.iter().find(|e| e.data.id == review_id)?;
        (!entry.thread.submitting).then(|| {
            (
                s.shop.clone(),
                s.object_id.clone(),
                entry.thread.total,
                s.generation,
            )
        })
    }) else {
        return;
    };
    if !can_reply {
        return;
    }
    update_entry(&review_id, |e| e.thread.submitting = true);
    let html = crate::format::to_html(&text);
    std::thread::spawn(move || {
        let posted = reviews::post_reply(&api, &shop, &object_id, &review_id, &html);
        let refreshed = posted.as_ref().ok().map(|_| {
            reviews::fetch_replies(&api, &shop, &object_id, &review_id, total.max(0) as usize)
        });
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            if let Err(error) = posted {
                eprintln!("Failed to submit reply: {error}");
                toast::error(&t("game_details.reply_submission_failed"));
                update_entry(&review_id, |e| e.thread.submitting = false);
                return;
            }
            with(|s| {
                if s.open_composer.as_deref() == Some(review_id.as_str()) {
                    s.open_composer = None;
                }
            });
            toast::success(&t("game_details.reply_submitted_successfully"));
            update_entry(&review_id, |e| {
                let t = &mut e.thread;
                t.prefill.clear();
                t.total += 1;
                t.hidden = false;
                t.expanded = true;
                t.submitting = false;
                match refreshed {
                    Some(Ok(page)) => {
                        if let Some(total) = page.total_count {
                            t.total = total;
                        }
                        t.replies = reviews::merge_replies(&t.replies, page.answers);
                    }
                    Some(Err(error)) => {
                        eprintln!("Failed to refresh replies after posting: {error}")
                    }
                    None => {}
                }
            });
            load_images();
        });
    });
}
