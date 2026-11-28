import type { Transition } from 'motion/react';

export const EASE_FLUID: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const SPRING_TAB: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 36,
  mass: 0.8,
};

export const SPRING_MODAL: Transition = {
  duration: 0.18,
  ease: EASE_FLUID,
};

export const TRANSITION_MICRO: Transition = {
  duration: 0.14,
  ease: EASE_FLUID,
};

export const TRANSITION_VIEW: Transition = {
  duration: 0.18,
  ease: EASE_FLUID,
};

export const VIEW_VARIANTS = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.01,
    },
  },
};

export const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: EASE_FLUID,
    },
  },
};
