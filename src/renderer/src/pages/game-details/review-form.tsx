import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EditorContent, Editor } from "@tiptap/react";
import { Button } from "@renderer/components";
import "./review-form.scss";

interface ReviewFormProps {
  editor: Editor | null;
  reviewScore: number | null;
  reviewCharCount: number;
  maxReviewChars: number;
  submittingReview: boolean;
  onScoreChange: (score: number) => void;
  onSubmit: () => void;
}

const getSelectScoreColorClass = (score: number): string => {
  if (score >= 1 && score <= 2) return "game-details__review-score-select--red";
  if (score >= 3 && score <= 3)
    return "game-details__review-score-select--yellow";
  if (score >= 4 && score <= 5)
    return "game-details__review-score-select--green";
  return "";
};

const getRatingText = (score: number, t: (key: string) => string): string => {
  switch (score) {
    case 1:
      return t("rating_very_negative");
    case 2:
      return t("rating_negative");
    case 3:
      return t("rating_neutral");
    case 4:
      return t("rating_positive");
    case 5:
      return t("rating_very_positive");
    default:
      return "";
  }
};

export function ReviewForm({
  editor,
  reviewScore,
  reviewCharCount,
  maxReviewChars,
  submittingReview,
  onScoreChange,
  onSubmit,
}: Readonly<ReviewFormProps>) {
  const { t } = useTranslation("game_details");

  return (
    <>
      <div className="game-details__reviews-header">
        <h3 className="game-details__reviews-title">{t("leave_a_review")}</h3>
      </div>

      <div className="game-details__review-form">
        <div className="game-details__review-input-container">
          <div className="game-details__review-input-header">
            <div className="game-details__review-editor-toolbar">
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBold().run()}
                className={`game-details__editor-button ${editor?.isActive("bold") ? "is-active" : ""}`}
                disabled={!editor}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                className={`game-details__editor-button ${editor?.isActive("italic") ? "is-active" : ""}`}
                disabled={!editor}
              >
                <em>I</em>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                className={`game-details__editor-button ${editor?.isActive("underline") ? "is-active" : ""}`}
                disabled={!editor}
              >
                <u>U</u>
              </button>
            </div>
            <div className="game-details__review-char-counter">
              <span
                className={reviewCharCount > maxReviewChars ? "over-limit" : ""}
              >
                {reviewCharCount}/{maxReviewChars}
              </span>
            </div>
          </div>
          <div className="game-details__review-input">
            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="game-details__review-form-bottom">
          <div className="game-details__review-score-container">
            <div className="game-details__star-rating">
              {[1, 2, 3, 4, 5].map((starValue) => (
                <button
                  key={starValue}
                  type="button"
                  className={`game-details__star ${
                    reviewScore && starValue <= reviewScore
                      ? "game-details__star--filled"
                      : "game-details__star--empty"
                  } ${
                    reviewScore && starValue <= reviewScore
                      ? getSelectScoreColorClass(reviewScore)
                      : ""
                  }`}
                  onClick={() => onScoreChange(starValue)}
                  title={getRatingText(starValue, t)}
                >
                  <Star
                    size={18}
                    fill={
                      reviewScore && starValue <= reviewScore
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
              ))}
            </div>
          </div>

          <Button
            theme="primary"
            onClick={onSubmit}
            disabled={
              !editor?.getHTML().trim() ||
              reviewScore === null ||
              submittingReview ||
              reviewCharCount > maxReviewChars
            }
          >
            {submittingReview ? t("submitting") : t("submit_review")}
          </Button>
        </div>
      </div>
    </>
  );
}
