import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import type { GameReviewAnswer, GameShop } from "@types";

import { useToast } from "@renderer/hooks";
import { AnswerItem } from "./answer-item";

import "./review-answers.scss";

const ANSWERS_PER_PAGE = 20;
const MAX_ANSWER_CHARS = 10000;

interface ReviewAnswersProps {
  reviewId: string;
  shop: GameShop;
  objectId: string;
  userDetailsId?: string;
  initialAnswerCount: number;
  initialAnswers?: GameReviewAnswer[];
  onAnswerCountChange: (newCount: number) => void;
  onReviewNotFound?: () => void;
}

export function ReviewAnswers({
  reviewId,
  shop,
  objectId,
  userDetailsId,
  initialAnswerCount,
  initialAnswers,
  onAnswerCountChange,
  onReviewNotFound,
}: Readonly<ReviewAnswersProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [answers, setAnswers] = useState<GameReviewAnswer[]>(
    () => initialAnswers ?? []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(
    initialAnswers !== undefined
  );
  const [hasMore, setHasMore] = useState(
    (initialAnswers?.length ?? 0) < initialAnswerCount
  );
  const [totalCount, setTotalCount] = useState(initialAnswerCount);
  const [votingAnswers, setVotingAnswers] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [answerCharCount, setAnswerCharCount] = useState(0);
  const [showReplyForm, setShowReplyForm] = useState(false);

  const previousVotesRef = useRef<
    Map<string, { upvotes: number; downvotes: number }>
  >(new Map());
  const onReviewNotFoundRef = useRef(onReviewNotFound);
  const initialAnswersRef = useRef(initialAnswers);
  const initialAnswerCountRef = useRef(initialAnswerCount);

  if (initialAnswersRef.current !== initialAnswers && reviewId) {
    initialAnswersRef.current = initialAnswers;
    initialAnswerCountRef.current = initialAnswerCount;
  }

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "game-details__answer-input",
        "data-placeholder": t("write_answer_placeholder"),
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setAnswerCharCount(text.length);
      if (text.length > MAX_ANSWER_CHARS) {
        editor.commands.setContent(text.slice(0, MAX_ANSWER_CHARS));
        setAnswerCharCount(MAX_ANSWER_CHARS);
      }
    },
  });

  const loadAnswers = useCallback(
    async (reset = false, nextSkip = 0) => {
      if (!reviewId) return;

      setIsLoading(true);
      try {
        const skip = reset ? 0 : nextSkip;
        const params = new URLSearchParams({
          take: String(ANSWERS_PER_PAGE),
          skip: String(skip),
        });

        const response = await window.electron.hydraApi.get<{
          answers: GameReviewAnswer[];
          totalCount: number;
        }>(
          `/games/${shop}/${objectId}/reviews/${reviewId}/answers?${params.toString()}`,
          { needsAuth: false }
        );

        const answersData = response?.answers ?? [];
        const count = response?.totalCount ?? 0;

        if (reset) {
          setAnswers(answersData);
        } else {
          setAnswers((prev) => [...prev, ...answersData]);
        }

        setTotalCount(count);
        setHasMore(skip + answersData.length < count);
        setHasLoadedOnce(true);
      } catch (err: unknown) {
        const code = (err as { response?: { data?: { message?: string } } })
          ?.response?.data?.message;
        if (code === "game/review-not-found") {
          onReviewNotFoundRef.current?.();
        }
      } finally {
        setIsLoading(false);
      }
    },
    [reviewId, shop, objectId]
  );

  useEffect(() => {
    onReviewNotFoundRef.current = onReviewNotFound;
  }, [onReviewNotFound]);

  useEffect(() => {
    const embeddedAnswers = initialAnswersRef.current;
    const embeddedAnswerCount = initialAnswerCountRef.current;

    if (embeddedAnswers !== undefined) {
      setAnswers(embeddedAnswers);
      setTotalCount(embeddedAnswerCount);
      setHasLoadedOnce(true);
      setHasMore(embeddedAnswers.length < embeddedAnswerCount);
      return;
    }

    loadAnswers(true);
  }, [reviewId, loadAnswers]);

  useEffect(() => {
    answers.forEach((answer) => {
      if (!previousVotesRef.current.has(answer.id)) {
        previousVotesRef.current.set(answer.id, {
          upvotes: answer.upvotes || 0,
          downvotes: answer.downvotes || 0,
        });
      }
    });
  }, [answers]);

  const handleVoteAnswer = async (
    answerId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (votingAnswers.has(answerId)) return;

    setVotingAnswers((prev) => new Set(prev).add(answerId));

    const answerIndex = answers.findIndex((a) => a.id === answerId);
    if (answerIndex === -1) {
      setVotingAnswers((prev) => {
        const next = new Set(prev);
        next.delete(answerId);
        return next;
      });
      return;
    }

    const answer = answers[answerIndex];
    const originalAnswer = { ...answer };
    const updated = { ...answer };

    if (voteType === "upvote") {
      if (answer.hasUpvoted) {
        updated.hasUpvoted = false;
        updated.upvotes = Math.max(0, (answer.upvotes || 0) - 1);
      } else {
        updated.hasUpvoted = true;
        updated.upvotes = (answer.upvotes || 0) + 1;
        if (answer.hasDownvoted) {
          updated.hasDownvoted = false;
          updated.downvotes = Math.max(0, (answer.downvotes || 0) - 1);
        }
      }
    } else {
      if (answer.hasDownvoted) {
        updated.hasDownvoted = false;
        updated.downvotes = Math.max(0, (answer.downvotes || 0) - 1);
      } else {
        updated.hasDownvoted = true;
        updated.downvotes = (answer.downvotes || 0) + 1;
        if (answer.hasUpvoted) {
          updated.hasUpvoted = false;
          updated.upvotes = Math.max(0, (answer.upvotes || 0) - 1);
        }
      }
    }

    const updatedAnswers = [...answers];
    updatedAnswers[answerIndex] = updated;
    setAnswers(updatedAnswers);

    try {
      await window.electron.hydraApi.put(
        `/games/${shop}/${objectId}/reviews/${reviewId}/answers/${answerId}/${voteType}`,
        { data: {} }
      );
    } catch (err: unknown) {
      const rolledBack = [...answers];
      rolledBack[answerIndex] = originalAnswer;
      setAnswers(rolledBack);

      const code = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      if (code === "game/too-many-vote-requests") {
        showErrorToast(t("answer_too_many_votes"));
      } else {
        showErrorToast(t("answer_vote_failed"));
      }
    } finally {
      setTimeout(() => {
        setVotingAnswers((prev) => {
          const next = new Set(prev);
          next.delete(answerId);
          return next;
        });
      }, 500);
    }
  };

  const handleDeleteAnswer = async (answerId: string) => {
    try {
      await window.electron.hydraApi.delete(
        `/games/${shop}/${objectId}/reviews/${reviewId}/answers/${answerId}`
      );
      setAnswers((prev) => prev.filter((a) => a.id !== answerId));
      const newCount = totalCount - 1;
      setTotalCount(newCount);
      onAnswerCountChange(newCount);
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      if (code === "game/review-answer-not-found") {
        setAnswers((prev) => prev.filter((a) => a.id !== answerId));
        const newCount = totalCount - 1;
        setTotalCount(newCount);
        onAnswerCountChange(newCount);
      } else {
        showErrorToast(t("answer_deletion_failed"));
      }
    }
  };

  const handleSubmitAnswer = async () => {
    const answerHtml = editor?.getHTML() || "";
    const answerText = editor?.getText() || "";

    if (!answerText.trim()) {
      showErrorToast(t("answer_cannot_be_empty"));
      return;
    }

    if (submitting || answerCharCount > MAX_ANSWER_CHARS) return;

    setSubmitting(true);
    try {
      const created = await window.electron.hydraApi.post<GameReviewAnswer>(
        `/games/${shop}/${objectId}/reviews/${reviewId}/answers`,
        { data: { answerHtml } }
      );

      editor?.commands.clearContent();
      setAnswerCharCount(0);
      setShowReplyForm(false);
      showSuccessToast(t("answer_submitted_successfully"));

      if (!hasMore && created) {
        setAnswers((prev) => [...prev, created]);
      }
      const newCount = totalCount + 1;
      setTotalCount(newCount);
      onAnswerCountChange(newCount);
    } catch {
      showErrorToast(t("answer_submission_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      loadAnswers(false, answers.length);
    }
  };

  const handleAnimationComplete = (
    answerId: string,
    votes: { upvotes: number; downvotes: number }
  ) => {
    previousVotesRef.current.set(answerId, votes);
  };

  return (
    <div className="game-details__answers-section">
      {isLoading && !hasLoadedOnce && (
        <div className="game-details__answers-loading">
          {t("loading_answers")}
        </div>
      )}

      {hasLoadedOnce && answers.length === 0 && (
        <div className="game-details__answers-empty">{t("no_answers_yet")}</div>
      )}

      {answers.length > 0 && (
        <div className="game-details__answers-list">
          {answers.map((answer) => (
            <AnswerItem
              key={answer.id}
              answer={answer}
              userDetailsId={userDetailsId}
              isVoting={votingAnswers.has(answer.id)}
              previousVotes={
                previousVotesRef.current.get(answer.id) || {
                  upvotes: 0,
                  downvotes: 0,
                }
              }
              onVote={handleVoteAnswer}
              onDelete={handleDeleteAnswer}
              onAnimationComplete={handleAnimationComplete}
            />
          ))}
        </div>
      )}

      {hasMore && !isLoading && (
        <button
          className="game-details__answers-load-more"
          onClick={handleLoadMore}
        >
          {t("load_more_answers")}
        </button>
      )}

      {isLoading && hasLoadedOnce && (
        <div className="game-details__answers-loading">
          {t("loading_more_answers")}
        </div>
      )}

      {userDetailsId && (
        <>
          {!showReplyForm ? (
            <button
              className="game-details__reply-toggle-button"
              onClick={() => {
                setShowReplyForm(true);
                setTimeout(() => editor?.commands.focus(), 50);
              }}
            >
              {t("reply")}
            </button>
          ) : (
            <div className="game-details__answer-form">
              <div className="game-details__answer-input-container">
                <div className="game-details__answer-editor-toolbar">
                  <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                    className={`game-details__answer-editor-button ${editor?.isActive("bold") ? "is-active" : ""}`}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                    className={`game-details__answer-editor-button ${editor?.isActive("italic") ? "is-active" : ""}`}
                  >
                    <em>I</em>
                  </button>
                </div>
                <div className="game-details__answer-input">
                  <EditorContent editor={editor} />
                </div>
              </div>
              <div className="game-details__answer-form-footer">
                <span className="game-details__answer-char-counter">
                  <span
                    className={
                      answerCharCount > MAX_ANSWER_CHARS ? "over-limit" : ""
                    }
                  >
                    {answerCharCount}/{MAX_ANSWER_CHARS}
                  </span>
                </span>
                <div className="game-details__answer-form-actions">
                  <button
                    className="game-details__answer-cancel-button"
                    onClick={() => {
                      setShowReplyForm(false);
                      editor?.commands.clearContent();
                      setAnswerCharCount(0);
                    }}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    className="game-details__answer-submit-button"
                    onClick={handleSubmitAnswer}
                    disabled={
                      submitting ||
                      answerCharCount === 0 ||
                      answerCharCount > MAX_ANSWER_CHARS
                    }
                  >
                    {submitting ? t("submitting_answer") : t("submit_answer")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
