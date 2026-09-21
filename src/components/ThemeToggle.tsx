"use client";

import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";
import {
  type ThemePreference,
  applyTheme,
  getStoredPreference,
  resolveTheme,
  setThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [mounted, setMounted] = useState(false);

  // Read the saved preference after mount (avoids server/client mismatch).
  useEffect(() => {
    setPreference(getStoredPreference());
    setMounted(true);
  }, []);

  // If the user picked "System", keep watching the OS setting live.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme(resolveTheme("system"));
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  const handleSelect = (value: ThemePreference) => {
    setPreference(value);
    setThemePreference(value);
  };

  if (!mounted) {
    // Reserve the space without rendering mismatched state during hydration.
    return <div className={styles.toggle} aria-hidden="true" />;
  }

  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          className={`${styles.option} ${
            preference === option.value ? styles.optionActive : ""
          }`}
          onClick={() => handleSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}