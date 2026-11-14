import "./download-flight.scss";

export const DOWNLOAD_FLIGHT_START_EVENT = "hydra:download-flight-start";
export const DOWNLOAD_FLIGHT_CANCEL_EVENT = "hydra:download-flight-cancel";
export const DOWNLOAD_LANDED_EVENT = "hydra:download-landed";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface FlightPoint {
  x: number;
  y: number;
}

export interface FlightProfile {
  /** Width and height of the flying element, in px. */
  size: number;
  startScale: number;
  liftScale: number;
  endScale: number;
  /** How far it rises off the button before it travels, in px. */
  liftHeight: number;
  /** How high the arc goes above the Downloads icon, as a share of the distance flown. */
  arcRatio: number;
  /** Largest lean into the direction of travel, in degrees. */
  tilt: number;
  liftDuration: number;
  travelDuration: number;
  absorbDuration: number;
}

export const ICON_FLIGHT: FlightProfile = {
  size: 44,
  startScale: 0.5,
  liftScale: 1.1,
  endScale: 0.3,
  liftHeight: 20,
  arcRatio: 0.24,
  tilt: -10,
  liftDuration: 170,
  travelDuration: 600,
  absorbDuration: 90,
};

/** For games without an icon: a small light flies instead. */
export const SPARK_FLIGHT: FlightProfile = {
  size: 8,
  startScale: 0,
  liftScale: 1.3,
  endScale: 0.7,
  liftHeight: 10,
  arcRatio: 0.15,
  tilt: 0,
  liftDuration: 110,
  travelDuration: 480,
  absorbDuration: 70,
};

export interface DownloadFlight {
  keyframes: Keyframe[];
  /** Length of the whole animation, in ms. */
  duration: number;
  /** When the flyer reaches the Downloads icon, in ms. */
  arrival: number;
}

const LIFT_FRAMES = 8;
const TRAVEL_FRAMES = 32;
const ABSORB_FRAMES = 4;

const easeOutBack = (t: number) => {
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Keyframes for a download that flies from the button that started it into
 * the sidebar's Downloads icon. It pops out and lifts off the button, then
 * falls along a parabola (a quadratic Bézier, so it moves like something
 * thrown), speeding up as it drops, and shrinks into the icon.
 */
export function getDownloadFlight(
  from: FlightPoint,
  to: FlightPoint,
  profile: FlightProfile
): DownloadFlight {
  const { size, liftDuration, travelDuration, absorbDuration } = profile;
  const duration = liftDuration + travelDuration + absorbDuration;
  const arrival = liftDuration + travelDuration;

  const launch = { x: from.x, y: from.y - profile.liftHeight };
  const distance = Math.hypot(to.x - launch.x, to.y - launch.y);
  const control = {
    x: to.x + (launch.x - to.x) * 0.36,
    y: Math.max(Math.min(launch.y, to.y) - distance * profile.arcRatio, 0),
  };

  const frame = (
    offset: number,
    point: FlightPoint,
    scale: number,
    rotation: number,
    opacity: number
  ): Keyframe => ({
    offset,
    opacity,
    transform: `translate(${(point.x - size / 2).toFixed(2)}px, ${(point.y - size / 2).toFixed(2)}px) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
  });

  const keyframes: Keyframe[] = [];

  for (let index = 0; index <= LIFT_FRAMES; index++) {
    const progress = index / LIFT_FRAMES;
    const scale =
      profile.startScale +
      (profile.liftScale - profile.startScale) * easeOutBack(progress);

    keyframes.push(
      frame(
        (progress * liftDuration) / duration,
        { x: from.x, y: from.y - profile.liftHeight * easeOutCubic(progress) },
        scale,
        0,
        Math.min(1, progress * 4)
      )
    );
  }

  for (let index = 1; index <= TRAVEL_FRAMES; index++) {
    const progress = index / TRAVEL_FRAMES;
    // Starts slow and speeds up, so it drops into the icon.
    const t = 0.45 * progress + 0.55 * progress ** 2;
    const point = {
      x: (1 - t) ** 2 * launch.x + 2 * t * (1 - t) * control.x + t ** 2 * to.x,
      y: (1 - t) ** 2 * launch.y + 2 * t * (1 - t) * control.y + t ** 2 * to.y,
    };
    // Stays big for the first half, then shrinks late, which reads as depth.
    const scale =
      profile.liftScale +
      (profile.endScale - profile.liftScale) * progress ** 2.2;
    const rotation =
      profile.tilt * Math.sin(Math.PI * Math.min(1, progress * 1.1));

    keyframes.push(
      frame(
        (liftDuration + progress * travelDuration) / duration,
        point,
        scale,
        rotation,
        1
      )
    );
  }

  for (let index = 1; index <= ABSORB_FRAMES; index++) {
    const progress = index / ABSORB_FRAMES;

    keyframes.push(
      frame(
        index === ABSORB_FRAMES
          ? 1
          : (arrival + progress * absorbDuration) / duration,
        to,
        profile.endScale * (1 - 0.75 * progress),
        0,
        1 - progress
      )
    );
  }

  return { keyframes, duration, arrival };
}

const center = (rect: DOMRect): FlightPoint => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const announce = (event: string) => window.dispatchEvent(new Event(event));

let isFlying = false;

function flyToDownloads(from: DOMRect | null, imageUrl?: string | null) {
  const target = document.querySelector("[data-sidebar-downloads-icon]");

  // No Downloads item to fly to, or its page is open and shows the new row.
  if (!target || target.closest(".sidebar__menu-item--active")) {
    announce(DOWNLOAD_FLIGHT_CANCEL_EVENT);
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const canFly =
    from !== null &&
    from.width > 0 &&
    targetRect.width > 0 &&
    !isFlying &&
    !window.matchMedia(REDUCED_MOTION_QUERY).matches;

  // The icon still reacts, in place.
  if (!canFly) {
    announce(DOWNLOAD_LANDED_EVENT);
    return;
  }

  const profile = imageUrl ? ICON_FLIGHT : SPARK_FLIGHT;
  const { keyframes, duration, arrival } = getDownloadFlight(
    center(from),
    center(targetRect),
    profile
  );

  const flyer = document.createElement("div");
  flyer.className = `download-flight download-flight--${imageUrl ? "icon" : "spark"}`;
  flyer.style.width = `${profile.size}px`;
  flyer.style.height = `${profile.size}px`;
  if (imageUrl)
    flyer.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
  document.body.appendChild(flyer);
  isFlying = true;

  let hasLanded = false;
  const land = () => {
    if (hasLanded) return;
    hasLanded = true;
    announce(DOWNLOAD_LANDED_EVENT);
  };
  const landingTimer = window.setTimeout(land, arrival);

  const animation = flyer.animate(keyframes, {
    duration,
    easing: "linear",
    fill: "both",
  });

  const finish = () => {
    window.clearTimeout(landingTimer);
    land();
    isFlying = false;
    flyer.remove();
  };

  animation.addEventListener("finish", finish);
  animation.addEventListener("cancel", finish);
}

export interface PendingDownloadFlight {
  /** The download started: fly into Downloads. */
  launch: (imageUrl?: string | null) => void;
  /** The download did not start. Does nothing after launch. */
  cancel: () => void;
}

/**
 * Call when the user clicks the button that starts a download, then `launch`
 * once it started or `cancel` if it did not. Until then the Downloads icon
 * keeps its current look, so the ring appears when the game lands.
 */
export function beginDownloadFlight(
  source: Element | null
): PendingDownloadFlight {
  const from = source?.getBoundingClientRect() ?? null;
  let isSettled = false;

  announce(DOWNLOAD_FLIGHT_START_EVENT);

  return {
    launch: (imageUrl) => {
      if (isSettled) return;
      isSettled = true;
      flyToDownloads(from, imageUrl);
    },
    cancel: () => {
      if (isSettled) return;
      isSettled = true;
      announce(DOWNLOAD_FLIGHT_CANCEL_EVENT);
    },
  };
}
