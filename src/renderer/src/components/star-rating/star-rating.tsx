import { StarIcon, StarFillIcon } from "@primer/octicons-react";
import "./star-rating.scss";

export interface StarRatingProps {
  rating: number | null;
  maxStars?: number;
  size?: number;
  showCalculating?: boolean;
  calculatingText?: string;
}

export function StarRating({
  rating,
  maxStars = 5,
  size = 12,
  showCalculating = false,
  calculatingText = "Calculating",
}: Readonly<StarRatingProps>) {
  if (rating === null && showCalculating) {
    return (
      <div className="star-rating star-rating--calculating">
        <StarIcon size={size} />
        <span className="star-rating__calculating-text">{calculatingText}</span>
      </div>
    );
  }

  if (rating === null || rating === undefined) {
    return (
      <div className="star-rating star-rating--no-rating">
        <StarIcon size={size} />
        <span className="star-rating__no-rating-text">…</span>
      </div>
    );
  }

  const filledStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = maxStars - filledStars - (hasHalfStar ? 1 : 0);

  return (
    <div className="star-rating">
      {Array.from({ length: filledStars }, (_, index) => (
        <StarFillIcon
          key={`filled-${index}`}
          size={size}
          className="star-rating__star star-rating__star--filled"
        />
      ))}

      {hasHalfStar && (
        <div className="star-rating__half-star" key="half-star">
          <StarIcon
            size={size}
            className="star-rating__star star-rating__star--empty"
          />
          <StarFillIcon
            size={size}
            className="star-rating__star star-rating__star--half"
          />
        </div>
      )}

      {Array.from({ length: emptyStars }, (_, index) => (
        <StarIcon
          key={`empty-${index}`}
          size={size}
          className="star-rating__star star-rating__star--empty"
        />
      ))}

      <span className="star-rating__value">{rating.toFixed(1)}</span>
    </div>
  );
}
