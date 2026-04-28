import "./styles.scss";

import type { ReactNode } from "react";

interface HorizontalCardProps {
  image: string;
  title: string;
  description: string;
  action: ReactNode;
}

export function HorizontalCard({
  image,
  title,
  description,
  action,
}: Readonly<HorizontalCardProps>) {
  return (
    <div className="horizontal-card">
      <div className="horizontal-card__image">
        <img
          src={image}
          width={268}
          height={136}
          alt={title}
          draggable={false}
        />
      </div>
      <div className="horizontal-card__content">
        <div className="horizontal-card__content__info">
          <h3 className="horizontal-card__content__info__title">{title}</h3>
          <p className="horizontal-card__content__info__description">
            {description}
          </p>
        </div>
        <div className="horizontal-card__content__action">{action}</div>
      </div>
    </div>
  );
}
