import lernaPromo from "@renderer/assets/lerna-promo.png";
import "./lerna-promo-card.scss";

export function LernaPromoCard() {
  const handleClick = () => {
    window.electron.openExternal("https://lerna.gg");
  };

  return (
    <button
      type="button"
      className="lerna-promo-card"
      onClick={handleClick}
      aria-label="Visit lerna.gg"
    >
      <img
        src={lernaPromo}
        alt="Lerna — No noise. No storefront. Just your library."
        className="lerna-promo-card__image"
        loading="eager"
      />
      <div className="lerna-promo-card__overlay">
        <span className="lerna-promo-card__cta">lerna.gg ↗</span>
      </div>
    </button>
  );
}
