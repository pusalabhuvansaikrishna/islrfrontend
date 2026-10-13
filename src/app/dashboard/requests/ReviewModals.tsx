"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./ReviewModals.module.css";
import { BASE_URL } from "@/config/api";
import type { AccountRequestRecord, RoleOption } from "./types";

const REASON_MAX = 500;

function errorFrom(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error,\s*/i, ""))
      .filter(Boolean);
    if (msgs.length) return msgs.join(" ");
  }
  return fallback;
}

// ── Shared modal shell ────────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.dialogHeader}>
          <h3 className={styles.title}>{title}</h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Approve: pick a role ──────────────────────────────────────────────────
export function ApproveModal({
  request,
  onClose,
  onDone,
}: {
  request: AccountRequestRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/account-requests/assignable-roles`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(errorFrom(data?.detail, "Failed to load roles."));
          return;
        }
        setRoles(data as RoleOption[]);
      } catch {
        if (!cancelled) setLoadError("Unable to connect to the server.");
      } finally {
        if (!cancelled) setLoadingRoles(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hovering (or keyboard-focusing) a role previews its permissions;
  // otherwise the selected role's permissions are shown.
  const previewRole = roles.find((r) => r.role_id === (hoveredId ?? selectedId));

  async function handleApprove() {
    if (!selectedId) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/account-requests/${request.request_id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role_id: selectedId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Could not approve this request."));
        return;
      }
      onDone();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Approve request" onClose={onClose} busy={submitting}>
      <p className={styles.intro}>
        Choose the role for <strong>{request.name}</strong> (@{request.username}). Their account
        will be created and they will be emailed.
      </p>

      {loadingRoles && <p className={styles.muted}>Loading roles…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loadingRoles && !loadError && roles.length === 0 && (
        <p className={styles.muted}>No assignable roles are available.</p>
      )}

      {roles.length > 0 && (
        <>
          <div className={styles.roleGrid} role="radiogroup" aria-label="Role">
            {roles.map((role) => (
              <button
                key={role.role_id}
                type="button"
                role="radio"
                aria-checked={selectedId === role.role_id}
                className={`${styles.roleBtn} ${selectedId === role.role_id ? styles.roleBtnSelected : ""}`}
                onClick={() => setSelectedId(role.role_id)}
                onMouseEnter={() => setHoveredId(role.role_id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(role.role_id)}
                onBlur={() => setHoveredId(null)}
              >
                {role.name}
              </button>
            ))}
          </div>

          <div className={styles.preview} aria-live="polite">
            {previewRole ? (
              <>
                <p className={styles.previewTitle}>
                  {previewRole.name} permissions
                  {previewRole.description ? ` — ${previewRole.description}` : ""}
                </p>
                {previewRole.permissions.length > 0 ? (
                  <div className={styles.chips}>
                    {previewRole.permissions.map((p) => (
                      <span key={p.permission_id} className={styles.chip} title={p.description ?? undefined}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={styles.muted}>No permissions assigned to this role.</p>
                )}
              </>
            ) : (
              <p className={styles.muted}>Hover over a role to see its permissions.</p>
            )}
          </div>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleApprove}
          disabled={!selectedId || submitting}
        >
          {submitting ? <span className={styles.spinner} /> : "Approve & create account"}
        </button>
      </div>
    </Modal>
  );
}

// ── Deny: optional reason ─────────────────────────────────────────────────
export function DenyModal({
  request,
  onClose,
  onDone,
}: {
  request: AccountRequestRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDeny() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/account-requests/${request.request_id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Could not deny this request."));
        return;
      }
      onDone();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Deny request" onClose={onClose} busy={submitting}>
      <p className={styles.intro}>
        Deny the request from <strong>{request.name}</strong> (@{request.username})? They will be
        emailed that their account was not approved.
      </p>

      <label htmlFor="deny-reason" className={styles.label}>
        Reason <span className={styles.optional}>(optional — included in the email to the applicant)</span>
      </label>
      <textarea
        id="deny-reason"
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <span className={styles.counter}>
        {reason.length}/{REASON_MAX}
      </span>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className={styles.dangerBtn} onClick={handleDeny} disabled={submitting}>
          {submitting ? <span className={styles.spinner} /> : "Deny request"}
        </button>
      </div>
    </Modal>
  );
}