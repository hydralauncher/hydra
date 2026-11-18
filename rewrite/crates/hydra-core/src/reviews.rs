//! Game reviews and their reply threads (game-reviews.tsx, review-thread.tsx,
//! review-item.tsx, review-reply-item.tsx): the API calls, the response
//! shapes, the optimistic vote rules and the translation choice
//! (src/shared/review-translation.ts).

use serde_json::{Value, json};

use crate::api::{ApiError, HydraApi, Options};

/// `take` of every review page.
pub const REVIEWS_PAGE_SIZE: usize = 20;
/// review-thread.tsx REPLIES_TAKE / PREVIEW_LIMIT.
pub const REPLIES_TAKE: usize = 10;
pub const REPLIES_PREVIEW_LIMIT: usize = 5;
/// MAX_REVIEW_CHARS / MAX_REPLY_CHARS.
pub const MAX_CHARS: usize = 1000;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Author {
    pub id: String,
    pub display_name: String,
    pub profile_image_url: Option<String>,
    pub background_image_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Votes {
    pub upvotes: i64,
    pub downvotes: i64,
    pub has_upvoted: bool,
    pub has_downvoted: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reply {
    pub id: String,
    pub html: String,
    pub created_at: String,
    pub votes: Votes,
    pub is_blocked: bool,
    pub user: Author,
    pub translations: Vec<(String, String)>,
    pub detected_language: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Review {
    pub id: String,
    pub html: String,
    pub score: i64,
    pub created_at: String,
    pub votes: Votes,
    pub answer_count: i64,
    pub answers: Vec<Reply>,
    pub is_blocked: bool,
    pub play_time_in_seconds: Option<f64>,
    pub user: Author,
    pub translations: Vec<(String, String)>,
    pub detected_language: Option<String>,
    pub recompilation_name: Option<String>,
}

fn string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn author(value: Option<&Value>) -> Author {
    let Some(user) = value else {
        return Author::default();
    };
    Author {
        id: string(user, "id"),
        display_name: string(user, "displayName"),
        profile_image_url: opt_string(user, "profileImageUrl"),
        background_image_url: opt_string(user, "backgroundImageUrl"),
    }
}

fn votes(value: &Value) -> Votes {
    Votes {
        upvotes: value.get("upvotes").and_then(Value::as_i64).unwrap_or(0),
        downvotes: value.get("downvotes").and_then(Value::as_i64).unwrap_or(0),
        has_upvoted: value.get("hasUpvoted").and_then(Value::as_bool) == Some(true),
        has_downvoted: value.get("hasDownvoted").and_then(Value::as_bool) == Some(true),
    }
}

fn translations(value: &Value) -> Vec<(String, String)> {
    value
        .get("translations")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_reply(value: &Value) -> Option<Reply> {
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    Some(Reply {
        id,
        html: string(value, "answerHtml"),
        created_at: string(value, "createdAt"),
        votes: votes(value),
        is_blocked: value.get("isBlocked").and_then(Value::as_bool) == Some(true),
        user: author(value.get("user")),
        translations: translations(value),
        detected_language: opt_string(value, "detectedLanguage"),
    })
}

pub fn parse_review(value: &Value) -> Option<Review> {
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    Some(Review {
        id,
        html: string(value, "reviewHtml"),
        score: value.get("score").and_then(Value::as_i64).unwrap_or(0),
        created_at: string(value, "createdAt"),
        votes: votes(value),
        answer_count: value
            .get("answerCount")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        answers: value
            .get("answers")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(parse_reply).collect())
            .unwrap_or_default(),
        is_blocked: value.get("isBlocked").and_then(Value::as_bool) == Some(true),
        play_time_in_seconds: value.get("playTimeInSeconds").and_then(Value::as_f64),
        user: author(value.get("user")),
        translations: translations(value),
        detected_language: opt_string(value, "detectedLanguage"),
        recompilation_name: value
            .get("recompilation")
            .and_then(|r| opt_string(r, "name")),
    })
}

/// `{ reviews, totalCount }`.
pub struct ReviewPage {
    pub reviews: Vec<Review>,
    pub total_count: i64,
}

/// GET /games/:shop/:objectId/reviews?take=20&skip=&sortBy=
pub fn fetch_reviews(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    skip: usize,
    sort_by: &str,
) -> Result<ReviewPage, ApiError> {
    let body = api.get(
        &format!("/games/{shop}/{object_id}/reviews"),
        &[
            ("take", REVIEWS_PAGE_SIZE.to_string()),
            ("skip", skip.to_string()),
            ("sortBy", sort_by.to_string()),
        ],
        Options::public(),
    )?;
    Ok(ReviewPage {
        reviews: body
            .get("reviews")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(parse_review).collect())
            .unwrap_or_default(),
        total_count: body.get("totalCount").and_then(Value::as_i64).unwrap_or(0),
    })
}

/// `{ answers, totalCount }`.
pub struct ReplyPage {
    pub answers: Vec<Reply>,
    pub total_count: Option<i64>,
}

/// GET /games/:shop/:objectId/reviews/:reviewId/answers?take=10&skip=
pub fn fetch_replies(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
    skip: usize,
) -> Result<ReplyPage, ApiError> {
    let body = api.get(
        &format!("/games/{shop}/{object_id}/reviews/{review_id}/answers"),
        &[
            ("take", REPLIES_TAKE.to_string()),
            ("skip", skip.to_string()),
        ],
        Options::public(),
    )?;
    Ok(ReplyPage {
        answers: body
            .get("answers")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(parse_reply).collect())
            .unwrap_or_default(),
        total_count: body.get("totalCount").and_then(Value::as_i64),
    })
}

/// "upvote" | "downvote"
pub fn vote_kind(up: bool) -> &'static str {
    if up { "upvote" } else { "downvote" }
}

/// PUT /games/:shop/:objectId/reviews/:reviewId/(upvote|downvote)
pub fn vote_review(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
    up: bool,
) -> Result<Value, ApiError> {
    api.put(
        &format!(
            "/games/{shop}/{object_id}/reviews/{review_id}/{}",
            vote_kind(up)
        ),
        &json!({}),
        Options::default(),
    )
}

/// PUT .../answers/:answerId/(upvote|downvote): `{ upvotes, downvotes }`.
pub fn vote_reply(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
    answer_id: &str,
    up: bool,
) -> Result<Option<(i64, i64)>, ApiError> {
    let body = api.put(
        &format!(
            "/games/{shop}/{object_id}/reviews/{review_id}/answers/{answer_id}/{}",
            vote_kind(up)
        ),
        &json!({}),
        Options::default(),
    )?;
    Ok(body
        .get("upvotes")
        .and_then(Value::as_i64)
        .zip(body.get("downvotes").and_then(Value::as_i64)))
}

/// POST /games/:shop/:objectId/reviews `{ reviewHtml, score }`
pub fn submit_review(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    html: &str,
    score: i64,
) -> Result<Value, ApiError> {
    api.post(
        &format!("/games/{shop}/{object_id}/reviews"),
        &json!({ "reviewHtml": html, "score": score }),
        Options::default(),
    )
}

/// DELETE /games/:shop/:objectId/reviews/:reviewId
pub fn delete_review(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
) -> Result<Value, ApiError> {
    api.delete(
        &format!("/games/{shop}/{object_id}/reviews/{review_id}"),
        Options::default(),
    )
}

/// POST .../answers `{ answerHtml }`
pub fn post_reply(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
    html: &str,
) -> Result<Value, ApiError> {
    api.post(
        &format!("/games/{shop}/{object_id}/reviews/{review_id}/answers"),
        &json!({ "answerHtml": html }),
        Options::default(),
    )
}

/// DELETE .../answers/:answerId
pub fn delete_reply(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    review_id: &str,
    answer_id: &str,
) -> Result<Value, ApiError> {
    api.delete(
        &format!("/games/{shop}/{object_id}/reviews/{review_id}/answers/{answer_id}"),
        Options::default(),
    )
}

/// GET /games/:shop/:objectId/reviews/check: `hasReviewed`.
pub fn has_reviewed(api: &HydraApi, shop: &str, object_id: &str) -> Result<bool, ApiError> {
    let body = api.get(
        &format!("/games/{shop}/{object_id}/reviews/check"),
        &[],
        Options::default(),
    )?;
    Ok(body.get("hasReviewed").and_then(Value::as_bool) == Some(true))
}

/// handleVoteReview's optimistic update for a review: a vote toggles, and
/// switching sides takes the other vote back.
pub fn toggle_review_vote(votes: &Votes, up: bool) -> Votes {
    let mut next = votes.clone();
    if up {
        if votes.has_upvoted {
            next.has_upvoted = false;
            next.upvotes = (votes.upvotes - 1).max(0);
        } else {
            next.has_upvoted = true;
            next.upvotes = votes.upvotes + 1;
            if votes.has_downvoted {
                next.has_downvoted = false;
                next.downvotes = (votes.downvotes - 1).max(0);
            }
        }
    } else if votes.has_downvoted {
        next.has_downvoted = false;
        next.downvotes = (votes.downvotes - 1).max(0);
    } else {
        next.has_downvoted = true;
        next.downvotes = votes.downvotes + 1;
        if votes.has_upvoted {
            next.has_upvoted = false;
            next.upvotes = (votes.upvotes - 1).max(0);
        }
    }
    next
}

/// review-thread.tsx `getOptimisticReplyVote`.
pub fn toggle_reply_vote(votes: &Votes, up: bool) -> Votes {
    let (has_up, has_down) = if up {
        let has_up = !votes.has_upvoted;
        (has_up, !has_up && votes.has_downvoted)
    } else {
        let has_down = !votes.has_downvoted;
        (!has_down && votes.has_upvoted, has_down)
    };
    let delta = |next: bool, prev: bool| next as i64 - prev as i64;
    Votes {
        upvotes: (votes.upvotes + delta(has_up, votes.has_upvoted)).max(0),
        downvotes: (votes.downvotes + delta(has_down, votes.has_downvoted)).max(0),
        has_upvoted: has_up,
        has_downvoted: has_down,
    }
}

/// review-thread.tsx `mergeReplies`: new replies appended, sorted by
/// createdAt then id.
pub fn merge_replies(existing: &[Reply], incoming: Vec<Reply>) -> Vec<Reply> {
    let mut merged = existing.to_vec();
    for reply in incoming {
        if !merged.iter().any(|r| r.id == reply.id) {
            merged.push(reply);
        }
    }
    let time = |r: &Reply| crate::library::parse_iso_millis(&r.created_at).unwrap_or(0);
    merged.sort_by(|a, b| time(a).cmp(&time(b)).then_with(|| a.id.cmp(&b.id)));
    merged
}

fn base_language(language: Option<&str>) -> String {
    language
        .and_then(|l| l.split('-').next())
        .unwrap_or_default()
        .to_string()
}

/// getReviewTranslationLanguage
pub fn translation_language(language: &str) -> String {
    language
        .split('-')
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

/// getReviewTranslation: the translation to show instead of the original,
/// never for the viewer's own text, only when it was written in another
/// language and a translation for the app language exists.
pub fn translation<'a>(
    translations: &'a [(String, String)],
    detected_language: Option<&str>,
    language: &str,
    own: bool,
) -> Option<&'a str> {
    if own || base_language(detected_language) == base_language(Some(language)) {
        return None;
    }
    let wanted = translation_language(language);
    translations
        .iter()
        .find(|(k, v)| *k == wanted && !v.is_empty())
        .map(|(_, v)| v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(up: i64, down: i64, has_up: bool, has_down: bool) -> Votes {
        Votes {
            upvotes: up,
            downvotes: down,
            has_upvoted: has_up,
            has_downvoted: has_down,
        }
    }

    #[test]
    fn review_votes_toggle_and_switch_sides() {
        assert_eq!(
            toggle_review_vote(&v(1, 0, false, false), true),
            v(2, 0, true, false)
        );
        assert_eq!(
            toggle_review_vote(&v(2, 0, true, false), true),
            v(1, 0, false, false)
        );
        assert_eq!(
            toggle_review_vote(&v(2, 0, true, false), false),
            v(1, 1, false, true)
        );
        assert_eq!(
            toggle_review_vote(&v(0, 0, false, false), false),
            v(0, 1, false, true)
        );
    }

    #[test]
    fn reply_votes_match_the_thread_rules() {
        assert_eq!(
            toggle_reply_vote(&v(1, 1, false, true), true),
            v(2, 0, true, false)
        );
        assert_eq!(
            toggle_reply_vote(&v(2, 0, true, false), true),
            v(1, 0, false, false)
        );
        assert_eq!(
            toggle_reply_vote(&v(0, 0, false, false), false),
            v(0, 1, false, true)
        );
    }

    #[test]
    fn picks_translations_like_the_renderer() {
        let translations = vec![("en".to_string(), "Hello".to_string())];
        assert_eq!(
            translation(&translations, Some("pt"), "en", false),
            Some("Hello")
        );
        assert_eq!(translation(&translations, Some("pt"), "en", true), None);
        assert_eq!(translation(&translations, Some("en"), "en-US", false), None);
        assert_eq!(translation(&translations, Some("pt"), "es", false), None);
        assert_eq!(translation(&translations, None, "en", false), Some("Hello"));
    }

    #[test]
    fn parses_reviews_and_merges_replies() {
        let review = parse_review(&json!({
            "id": "r1", "reviewHtml": "<p>x</p>", "score": 4, "createdAt": "2026-01-01T00:00:00.000Z",
            "upvotes": 3, "downvotes": 1, "hasUpvoted": true, "answerCount": 2,
            "answers": [{ "id": "a1", "answerHtml": "<p>y</p>", "createdAt": "2026-01-02T00:00:00.000Z",
                "user": { "id": "u2", "displayName": "B" } }],
            "user": { "id": "u1", "displayName": "A", "profileImageUrl": "p.png" },
            "translations": { "en": "<p>x</p>" }, "detectedLanguage": "pt",
            "recompilation": { "name": "Ship" }
        }))
        .unwrap();
        assert_eq!(review.score, 4);
        assert_eq!(review.votes, v(3, 1, true, false));
        assert_eq!(review.answers.len(), 1);
        assert_eq!(review.user.profile_image_url.as_deref(), Some("p.png"));
        assert_eq!(review.recompilation_name.as_deref(), Some("Ship"));

        let reply = |id: &str, at: &str| Reply {
            id: id.into(),
            created_at: at.into(),
            ..Default::default()
        };
        let merged = merge_replies(
            &[
                reply("b", "2026-01-02T00:00:00Z"),
                reply("a", "2026-01-03T00:00:00Z"),
            ],
            vec![
                reply("c", "2026-01-01T00:00:00Z"),
                reply("b", "2026-01-02T00:00:00Z"),
            ],
        );
        assert_eq!(
            merged.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["c", "b", "a"]
        );
    }
}
