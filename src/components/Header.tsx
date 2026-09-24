"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Header.module.css";
import { useAuth } from "@/lib/auth-context";
import type { CurrentUser } from "@/lib/auth";
import CreateDatasetModal from "./CreateDatasetModal";

function BrandMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M14 26V13a3 3 0 0 1 6 0v9M20 22v-4a3 3 0 0 1 6 0v4M26 22.5v-2a3 3 0 0 1 6 0V24M32 24v-1a2.6 2.6 0 0 1 5.2 0v9.2c0 5.5-4.3 10.8-11.4 10.8h-2.2C16.8 43 12 38 12 32.6V27l-3.4-3.6a2.4 2.4 0 0 1 3.3-3.5L14 22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Header({
  user,
  onCreateDataset,
}: {
  user: CurrentUser;
  /** Optional extra hook (e.g. analytics) fired when the modal opens. The modal itself is owned by Header. */
  onCreateDataset?: () => void;
}) {
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  const handleCreateDatasetClick = () => {
    setDatasetModalOpen(true);
    onCreateDataset?.();
  };

  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className={styles.header}>
      <div className={styles.brandGroup}>
        <div className={styles.logoWrap} aria-hidden="true">
          <BrandMark />
        </div>
        <span className={styles.portalTitle}>ISLR DATA CAPTURE</span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.createButton}
          onClick={handleCreateDatasetClick}
        >
          <svg
            viewBox="0 0 12 12"
            width="12"
            height="12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 1.5v9M1.5 6h9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          Create Job
        </button>

        <div className={styles.menuWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.profileTrigger}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <span className={styles.avatar}>{initial}</span>
            <span className={styles.profileName}>{user.name}</span>
            <svg
              className={`${styles.chevron} ${menuOpen ? styles.chevronOpen : ""}`}
              viewBox="0 0 12 12"
              width="10"
              height="10"
              fill="none"
              aria-hidden="true"
            >
              <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {menuOpen && (
            <div className={styles.dropdown} role="menu">
              <div className={styles.dropdownHeader}>
                <p className={styles.dropdownName}>{user.name}</p>
                <p className={styles.dropdownRole}>{user.role}</p>
              </div>
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={handleLogout}
                disabled={loggingOut}
                role="menuitem"
              >
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          )}
        </div>
      </div>

      <CreateDatasetModal
        open={datasetModalOpen}
        onClose={() => setDatasetModalOpen(false)}
        onProcess={async ({ file, requestorId }) => {
          // TODO: wire to the real create-job endpoint once it exists.
          console.log("Process dataset", { file, requestorId });
        }}
      />
    </header>
  );
}