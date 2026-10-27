"use client";

import { useEffect, useRef } from "react";
import styles from "./BulkDownload.module.css";

type Props = {
  checked: boolean;
  /** Show the "some selected" dash (used by the select-all-in-take checkbox). */
  indeterminate?: boolean;
  onChange: () => void;
  label: string; // accessible name
  disabled?: boolean;
  className?: string;
};

export default function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  className,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={`${styles.checkbox} ${className ?? ""}`}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
    />
  );
}
