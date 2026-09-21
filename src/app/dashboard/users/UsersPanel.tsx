"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { UserAccount } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";
import EditUserModal from "./EditUserModal";

interface UsersPanelProps {
  refreshKey: number;
  // Optional: pass the signed-in user's id so we can disable the
  // "Deactivate" action on their own row (the backend also rejects this
  // with a 400, but disabling it client-side avoids a round trip).
  currentUserId?: string;
}

export default function UsersPanel({
  refreshKey,
  currentUserId,
}: UsersPanelProps) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [editTarget, setEditTarget] = useState<UserAccount | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Which user's menu is open, plus the screen position to render it at.
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
        // GET /users defaults to role=User server-side, so no query
        // param is needed here — this panel only ever shows User accounts.
        const data = await apiFetch<UserAccount[]>("/users");
        if (!cancelled) setUsers(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load users."
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
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
    );
  }, [users, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    setTimeout(() => setJustReset(null), 4000);
  }

  function handleUpdated(updated: UserAccount) {
    setUsers((prev) =>
      prev.map((u) => (u.user_id === updated.user_id ? updated : u))
    );
    setEditTarget(null);
  }

  async function handleToggleStatus(user: UserAccount) {
    if (togglingId) return;
    setTogglingId(user.user_id);
    setToggleError(null);
    setOpenMenuId(null);

    try {
      const updated = await apiFetch<UserAccount>(
        `/users/${user.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !user.is_active }),
        }
      );
      setUsers((prev) =>
        prev.map((u) => (u.user_id === updated.user_id ? updated : u))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${user.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  function toggleMenu(user: UserAccount) {
    if (openMenuId === user.user_id) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }
    const btn = triggerRefs.current.get(user.user_id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - 176, // 176px ~= menu width; adjust to match your CSS
      });
    }
    setOpenMenuId(user.user_id);
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading users…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load users: {error}</p>
      </div>
    );
  }

  const activeUser = filtered.find((u) => u.user_id === openMenuId) ?? null;

  return (
    <div className={styles.card}>
      <div className={styles.panelHeader}>
        <input
          type="search"
          placeholder="Search by name, username, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          aria-label="Search users"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "user" : "users"}
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
            {users.length === 0
              ? "No users yet. Add one to get started."
              : `No users match "${query}".`}
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
              {filtered.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.name}</td>
                  <td className={styles.mutedCell}>{user.username}</td>
                  <td className={styles.mutedCell}>{user.email || "—"}</td>
                  <td>
                    <span
                      className={`${styles.statusDot} ${
                        user.is_active
                          ? styles.statusActive
                          : styles.statusSuspended
                      }`}
                    >
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className={styles.mutedCell}>
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ textAlign: "right", position: "relative" }}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) triggerRefs.current.set(user.user_id, el);
                        else triggerRefs.current.delete(user.user_id);
                      }}
                      className={styles.menuTrigger}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === user.user_id}
                      onClick={() => toggleMenu(user)}
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
        activeUser &&
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
                setEditTarget(activeUser);
                setOpenMenuId(null);
              }}
            >
              Edit details
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => handleToggleStatus(activeUser)}
              disabled={
                togglingId === activeUser.user_id ||
                (currentUserId === activeUser.user_id && activeUser.is_active)
              }
              title={
                currentUserId === activeUser.user_id && activeUser.is_active
                  ? "You can't deactivate your own account"
                  : undefined
              }
            >
              {togglingId === activeUser.user_id
                ? "Updating…"
                : activeUser.is_active
                ? "Deactivate"
                : "Activate"}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setResetTarget(activeUser);
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
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}