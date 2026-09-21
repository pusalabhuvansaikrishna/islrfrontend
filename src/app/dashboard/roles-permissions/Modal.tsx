"use client";

import { ReactNode } from "react";
import styles from "./page.module.css";

export default function Modal({
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={wide ? styles.modalWide : styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {subtitle && <p className={styles.modalSubtitle}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}