import { Star1 } from "iconsax-reactjs";
import "./star-rating.scss";

export interface StarRatingProps {
  rating: number | null;
  size?: number;
}

export function StarRating({ rating = 12 }: Readonly<StarRatingProps>) {
  if (rating === null || rating === undefined) {
    return (
      <div className="star-rating star-rating--single">
        <Star1
          size={16}
          className="star-rating__star star-rating__star--filled"
        />
        <span className="star-rating__value">…</span>
      </div>
    );
  }

  // Always use single star mode with numeric score
  return (
    <div className="star-rating star-rating--single">
      <Star1
        size={16}
        className="star-rating__star star-rating__star--filled"
        variant="Bold"
      />
      <span className="star-rating__value">{rating.toFixed(1)}</span>
    </div>
  );
}
