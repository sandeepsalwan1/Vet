"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MiniConfetti } from "../TaskBoardChrome";

const SAVE_CELEBRATION_DURATION_MS = 900;

export function useSaveCelebration() {
  const [state, setState] = useState({ animationKey: 0, visible: false });
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const celebrate = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    setState((current) => ({
      animationKey: current.animationKey + 1,
      visible: true
    }));
    timeoutRef.current = window.setTimeout(() => {
      setState((current) => ({ ...current, visible: false }));
      timeoutRef.current = null;
    }, SAVE_CELEBRATION_DURATION_MS);
  }, []);

  return { celebrate, ...state };
}

export function SaveCelebration({
  animationKey,
  visible
}: {
  animationKey: number;
  visible: boolean;
}) {
  return visible ? <MiniConfetti key={animationKey} /> : null;
}
