"use client";

// Location: src/components/CountdownOverlay.tsx
// Ported verbatim from the recorder project — no changes needed.

import { useEffect, useState } from "react";
import styles from "./CountdownOverlay.module.css";

interface Props {
  seconds?: number; // starting count, defaults to 3
  onTick?: (value: number) => void;
  onComplete: () => void;
}

// Renders 3, 2, 1 over the camera grid, then fires onComplete. Purely
// presentational/local timing — the caller decides what "complete" means
// (starting the actual recording command, in our case).
export default function CountdownOverlay({ seconds = 3, onTick, onComplete }: Props) {
  const [value, setValue] = useState(seconds);

  useEffect(() => {
    if (value <= 0) {
      onComplete();
      return;
    }
    onTick?.(value);
    const timer = setTimeout(() => setValue((v) => v - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (value <= 0) return null;

  return (
    <div className={styles.overlay} aria-live="assertive">
      <span key={value} className={styles.number}>
        {value}
      </span>
    </div>
  );
}