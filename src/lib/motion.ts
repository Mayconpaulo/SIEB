import type { Transition } from 'motion/react';

export const EASE_FLUID: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const SPRING_TAB: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.85,
};

export const SPRING_MODAL: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 28,
};

export const TRANSITION_MICRO: Transition = {
  duration: 0.17,
  ease: EASE_FLUID,
};

export const TRANSITION_VIEW: Transition = {
  duration: 0.22,
  ease: EASE_FLUID,
};

export const VIEW_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: EASE_FLUID,
    },
  },
};
