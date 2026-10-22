import { COIN_ROWS, GAMIFICATION_PALETTE } from "./gamification-art";
import { mixHex, prefersReducedMotion, rampColor } from "./gamification-colors";
import { drawPixelArt } from "./pixel-art";
import "./reward-effects.scss";

// Ported from the designer's prototype (confetti, floating chips).

const CONFETTI_PIECES = 130;
const CONFETTI_SCALE = 0.36;
const CONFETTI_SPEED = 1.15;
const CONFETTI_END = 2.6;
const FLOAT_LIFETIME_MS = 1400;
const COINS_ANCHOR_SELECTOR = "[data-gamification-coins]";

export function launchConfetti(origin: DOMRect | null) {
  if (!origin || prefersReducedMotion()) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.className = "gamification-confetti";
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  document.body.appendChild(canvas);

  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const palette = [
    ...[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map(rampColor),
    "#ffffff",
  ];
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;
  const scale = CONFETTI_SCALE;

  const pieces = Array.from({ length: CONFETTI_PIECES }, (_, index) => {
    const side = index % 2 ? 1 : -1;
    const angle = ((-90 + side * (18 + Math.random() * 55)) * Math.PI) / 180;
    const speed = (1500 + Math.random() * 1700) * scale;
    return {
      x: originX + side * Math.random() * 30,
      y: originY,
      vx: Math.cos(angle) * speed * (0.55 + Math.random() * 0.6),
      vy: Math.sin(angle) * speed,
      w: (12 + Math.random() * 16) * scale * 1.3,
      h: (8 + Math.random() * 24) * scale * 1.3,
      color: palette[index % palette.length],
      rotation: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * 14,
      flip: 2 + Math.random() * 5,
      delay: Math.random() * 0.12,
    };
  });

  const start = performance.now();
  const step = (now: number) => {
    const elapsed = ((now - start) / 1000) * CONFETTI_SPEED;
    context.clearRect(0, 0, width, height);

    for (const piece of pieces) {
      const t = elapsed - piece.delay;
      if (t < 0) continue;
      const drag = Math.exp(-2.2 * t);
      const x =
        piece.x +
        (piece.vx * (1 - drag)) / 2.2 +
        Math.sin(t * piece.flip) * 30 * scale * t;
      const y = piece.y + (piece.vy * (1 - drag)) / 2.2 + 520 * scale * t * t;
      const alpha =
        Math.min(1, t * 12) * (1 - Math.max(0, (elapsed - 1.9) / 0.7));
      if (alpha <= 0 || y > height + 20) continue;

      context.save();
      context.globalAlpha = alpha;
      context.translate(x, y);
      context.rotate(piece.rotation + piece.spin * t);
      context.scale(1, Math.cos(t * piece.flip * 1.6));
      context.fillStyle = piece.color;
      context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      context.restore();
    }

    if (elapsed < CONFETTI_END) {
      requestAnimationFrame(step);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(step);
}

const createCoinCanvas = () => {
  const canvas = document.createElement("canvas");
  drawPixelArt(
    canvas,
    COIN_ROWS,
    {
      "#": mixHex(GAMIFICATION_PALETTE.coin, "#ffffff", 0.45),
      "+": GAMIFICATION_PALETTE.coin,
      ":": mixHex(GAMIFICATION_PALETTE.coin, "#000000", 0.45),
    },
    16
  );
  return canvas;
};

export function floatRewardChips(
  anchor: Element | null,
  xp: number,
  coins: number
) {
  if (!anchor || prefersReducedMotion()) return;
  const rect = anchor.getBoundingClientRect();

  const make = (
    content: (Node | string)[],
    offsetX: number,
    delayMs: number
  ) => {
    const chip = document.createElement("span");
    chip.className = "gamification-float";
    chip.append(...content);
    chip.style.left = `${rect.left + rect.width / 2 + offsetX}px`;
    chip.style.top = `${rect.top}px`;
    chip.style.animationDelay = `${delayMs}ms`;
    document.body.appendChild(chip);
    setTimeout(() => chip.remove(), FLOAT_LIFETIME_MS + delayMs);
  };

  if (xp) make([`+${xp} XP`], -26, 0);
  if (coins) make([createCoinCanvas(), `+${coins}`], 26, 120);
}

/** Confetti from the claim button (its rect at click time) and chips floating from the coins pill. */
export function celebrateReward(
  origin: DOMRect | null,
  xp: number,
  coins: number
) {
  launchConfetti(origin);
  floatRewardChips(document.querySelector(COINS_ANCHOR_SELECTOR), xp, coins);
}
