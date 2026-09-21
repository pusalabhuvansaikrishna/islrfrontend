"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { Editor } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";
import EditEditorModal from "./EditEditorModal";

interface EditorsPanelProps {
  refreshKey: number;
}

export default function EditorsPanel({ refreshKey }: EditorsPanelProps) {
  const [editors, setEditors] = useState<Editor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<Editor | null>(null);
  const [editTarget, setEditTarget] = useState<Editor | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Which editor's menu is open, plus the screen position to render it at.
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
        const data = await apiFetch<Editor[]>("/editors");
        if (!cancelled) setEditors(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load editors."
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
    if (!q) return editors;
    return editors.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q)
    );
  }, [editors, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    setTimeout(() => setJustReset(null), 4000);
  }

  function handleUpdated(updated: Editor) {
    setEditors((prev) =>
      prev.map((e) => (e.user_id === updated.user_id ? updated : e))
    );
    setEditTarget(null);
  }

  async function handleToggleStatus(editor: Editor) {
    if (togglingId) return;
    setTogglingId(editor.user_id);
    setToggleError(null);
    setOpenMenuId(null);

    try {
      const updated = await apiFetch<Editor>(
        `/editors/${editor.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !editor.is_active }),
        }
      );
      setEditors((prev) =>
        prev.map((e) => (e.user_id === updated.user_id ? updated : e))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${editor.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  function toggleMenu(editor: Editor) {
    if (openMenuId === editor.user_id) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }
    const btn = triggerRefs.current.get(editor.user_id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - 176, // 176px ~= menu width; adjust to match your CSS
      });
    }
    setOpenMenuId(editor.user_id);
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading editors…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load editors: {error}</p>
      </div>
    );
  }

  const activeEditor = filtered.find((e) => e.user_id === openMenuId) ?? null;

  return (
    <div className={styles.card}>
      <div className={styles.panelHeader}>
        <input
          type="search"
          placeholder="Search by name, username, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          aria-label="Search editors"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "editor" : "editors"}
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
            {editors.length === 0
              ? "No editors yet. Add one to get started."
              : `No editors match "${query}".`}
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
              {filtered.map((editor) => (
                <tr key={editor.user_id}>
                  <td>{editor.name}</td>
                  <td className={styles.mutedCell}>{editor.username}</td>
                  <td className={styles.mutedCell}>{editor.email || "—"}</td>
                  <td>
                    <span
                      className={`${styles.statusDot} ${
                        editor.is_active
                          ? styles.statusActive
                          : styles.statusSuspended
                      }`}
                    >
                      {editor.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className={styles.mutedCell}>
                    {editor.created_at
                      ? new Date(editor.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ textAlign: "right", position: "relative" }}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) triggerRefs.current.set(editor.user_id, el);
                        else triggerRefs.current.delete(editor.user_id);
                      }}
                      className={styles.menuTrigger}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === editor.user_id}
                      onClick={() => toggleMenu(editor)}
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
        activeEditor &&
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
                setEditTarget(activeEditor);
                setOpenMenuId(null);
              }}
            >
              Edit details
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => handleToggleStatus(activeEditor)}
              disabled={togglingId === activeEditor.user_id}
            >
              {togglingId === activeEditor.user_id
                ? "Updating…"
                : activeEditor.is_active
                ? "Deactivate"
                : "Activate"}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setResetTarget(activeEditor);
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
          editor={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}

      {editTarget && (
        <EditEditorModal
          editor={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}