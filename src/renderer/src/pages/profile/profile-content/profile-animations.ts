export const sectionVariants = {
  collapsed: {
    opacity: 0,
    y: -20,
    height: 0,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
      opacity: { duration: 0.1 },
      y: { duration: 0.1 },
      height: { duration: 0.2 },
    },
  },
  expanded: {
    opacity: 1,
    y: 0,
    height: "auto",
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
      opacity: { duration: 0.2, delay: 0.1 },
      y: { duration: 0.3 },
      height: { duration: 0.3 },
    },
  },
} as const;

export const gameCardVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.95,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  },
} as const;

export const gameGridVariants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.3,
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
};

export const chevronVariants = {
  collapsed: {
    rotate: 0,
    transition: {
      duration: 0.2,
      ease: "easeInOut" as const,
    },
  },
  expanded: {
    rotate: 90,
    transition: {
      duration: 0.2,
      ease: "easeInOut" as const,
    },
  },
} as const;

export const GAME_STATS_ANIMATION_DURATION_IN_MS = 3500;
