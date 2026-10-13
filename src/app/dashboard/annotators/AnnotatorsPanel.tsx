"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { Annotator } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";
import EditAnnotatorModal from "./EditAnnotatorModal";

interface AnnotatorsPanelProps {
  refreshKey: number;
}

export default function AnnotatorsPanel({ refreshKey }: AnnotatorsPanelProps) {
  const [annotators, setAnnotators] = useState<Annotator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<Annotator | null>(null);
  const [editTarget, setEditTarget] = useState<Annotator | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Which annotator's menu is open, plus the screen position to render it at.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );

  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const clickedTrigger = Array.from(triggerRefs.current.values()).some(
        (btn) => btn.contains(target)
      );
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !clickedTrigger
      ) {
        setOpenMenuId(null);
      }
    }
    function handleScrollOrResize() {
      setOpenMenuId(null);
    }
    if (openMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [openMenuId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<Annotator[]>("/annotators");
        if (!cancelled) setAnnotators(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load annotators."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return annotators;
    return annotators.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q)
    );
  }, [annotators, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    setTimeout(() => setJustReset(null), 4000);
  }

  function handleUpdated(updated: Annotator) {
    setAnnotators((prev) =>
      prev.map((a) => (a.user_id === updated.user_id ? updated : a))
    );
    setEditTarget(null);
  }

  async function handleToggleStatus(annotator: Annotator) {
    if (togglingId) return;
    setTogglingId(annotator.user_id);
    setToggleError(null);
    setOpenMenuId(null);

    try {
      const updated = await apiFetch<Annotator>(
        `/annotators/${annotator.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !annotator.is_active }),
        }
      );
      setAnnotators((prev) =>
        prev.map((a) => (a.user_id === updated.user_id ? updated : a))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${annotator.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  function toggleMenu(annotator: Annotator) {
    if (openMenuId === annotator.user_id) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }
    const btn = triggerRefs.current.get(annotator.user_id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - 176, // 176px ~= menu width; adjust to match your CSS
      });
    }
    setOpenMenuId(annotator.user_id);
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading annotators…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load annotators: {error}</p>
      </div>
    );
  }

  const activeAnnotator = filtered.find((a) => a.user_id === openMenuId) ?? null;

  return (
    <div className={styles.card}>
      <div className={styles.panelHeader}>
        <input
          type="search"
          placeholder="Search by name, username, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          aria-label="Search annotators"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "annotator" : "annotators"}
        </span>
      </div>

      {justReset && (
        <p className={styles.subtitle}>
          Password reset for <strong>{justReset}</strong>.
        </p>
      )}

      {toggleError && <p className={styles.errorText}>{toggleError}</p>}

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {annotators.length === 0
              ? "No annotators yet. Add one to get started."
              : `No annotators match "${query}".`}
          </p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Status</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((annotator) => (
                <tr key={annotator.user_id}>
                  <td>{annotator.name}</td>
                  <td className={styles.mutedCell}>{annotator.username}</td>
                  <td className={styles.mutedCell}>{annotator.email || "—"}</td>
                  <td>
                    <span
                      className={`${styles.statusDot} ${
                        annotator.is_active
                          ? styles.statusActive
                          : styles.statusSuspended
                      }`}
                    >
                      {annotator.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className={styles.mutedCell}>
                    {annotator.created_at
                      ? new Date(annotator.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ textAlign: "right", position: "relative" }}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) triggerRefs.current.set(annotator.user_id, el);
                        else triggerRefs.current.delete(annotator.user_id);
                      }}
                      className={styles.menuTrigger}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === annotator.user_id}
                      onClick={() => toggleMenu(annotator)}
                    >
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openMenuId &&
        activeAnnotator &&
        menuPos &&
        createPortal(
          <div
            className={styles.menu}
            role="menu"
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 1000,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setEditTarget(activeAnnotator);
                setOpenMenuId(null);
              }}
            >
              Edit details
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => handleToggleStatus(activeAnnotator)}
              disabled={togglingId === activeAnnotator.user_id}
            >
              {togglingId === activeAnnotator.user_id
                ? "Updating…"
                : activeAnnotator.is_active
                ? "Deactivate"
                : "Activate"}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setResetTarget(activeAnnotator);
                setOpenMenuId(null);
              }}
            >
              Reset password
            </button>
          </div>,
          document.body
        )}

      {resetTarget && (
        <ResetPasswordModal
          annotator={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}

      {editTarget && (
        <EditAnnotatorModal
          annotator={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
