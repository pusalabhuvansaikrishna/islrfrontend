"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./page.module.css";
import { apiFetch, ApiError } from "./api";
import type { Admin } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";
import EditAdminModal from "./EditAdminModal";

interface AdminsPanelProps {
  refreshKey: number;
}

export default function AdminsPanel({ refreshKey }: AdminsPanelProps) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<Admin | null>(null);
  const [editTarget, setEditTarget] = useState<Admin | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Which admin's menu is open, plus the screen position to render it at.
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
      // Close on scroll/resize so the menu never gets visually stranded.
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
        const data = await apiFetch<Admin[]>("/admins");
        if (!cancelled) setAdmins(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load admins."
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
    if (!q) return admins;
    return admins.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q)
    );
  }, [admins, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    setTimeout(() => setJustReset(null), 4000);
  }

  function handleUpdated(updated: Admin) {
    setAdmins((prev) =>
      prev.map((a) => (a.user_id === updated.user_id ? updated : a))
    );
    setEditTarget(null);
  }

  async function handleToggleStatus(admin: Admin) {
    if (togglingId) return;
    setTogglingId(admin.user_id);
    setToggleError(null);
    setOpenMenuId(null);

    try {
      const updated = await apiFetch<Admin>(
        `/admins/${admin.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !admin.is_active }),
        }
      );
      setAdmins((prev) =>
        prev.map((a) => (a.user_id === updated.user_id ? updated : a))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${admin.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  function toggleMenu(admin: Admin) {
    if (openMenuId === admin.user_id) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }
    const btn = triggerRefs.current.get(admin.user_id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      // Position menu just under the trigger, right-aligned to it.
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - 176, // 176px ~= menu width; adjust to match your CSS
      });
    }
    setOpenMenuId(admin.user_id);
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading admins…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load admins: {error}</p>
      </div>
    );
  }

  const activeAdmin = filtered.find((a) => a.user_id === openMenuId) ?? null;

  return (
    <div className={styles.card}>
      <div className={styles.panelHeader}>
        <input
          type="search"
          placeholder="Search by name, username, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          aria-label="Search admins"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "admin" : "admins"}
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
            {admins.length === 0
              ? "No admin accounts available."
              : `No admins match "${query}".`}
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
              {filtered.map((admin) => (
                <tr key={admin.user_id}>
                  <td>{admin.name}</td>
                  <td className={styles.mutedCell}>{admin.username}</td>
                  <td className={styles.mutedCell}>{admin.email || "—"}</td>
                  <td>
                    <span
                      className={`${styles.statusDot} ${
                        admin.is_active
                          ? styles.statusActive
                          : styles.statusSuspended
                      }`}
                    >
                      {admin.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className={styles.mutedCell}>
                    {new Date(admin.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: "right", position: "relative" }}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) triggerRefs.current.set(admin.user_id, el);
                        else triggerRefs.current.delete(admin.user_id);
                      }}
                      className={styles.menuTrigger}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === admin.user_id}
                      onClick={() => toggleMenu(admin)}
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
        activeAdmin &&
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
                setEditTarget(activeAdmin);
                setOpenMenuId(null);
              }}
            >
              Edit details
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => handleToggleStatus(activeAdmin)}
              disabled={togglingId === activeAdmin.user_id}
            >
              {togglingId === activeAdmin.user_id
                ? "Updating…"
                : activeAdmin.is_active
                ? "Deactivate"
                : "Activate"}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setResetTarget(activeAdmin);
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
          admin={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}

      {editTarget && (
        <EditAdminModal
          admin={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}