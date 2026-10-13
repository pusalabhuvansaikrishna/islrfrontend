"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import styles from "./RecorderModals.module.css";
import { BASE_URL } from "@/config/api";
import type { RecorderRecord } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPECIAL_CHARS = /[!@#$%^&*(),.?":{}|<>]/;

// FastAPI returns either a string or a list of validation errors.
export function errorFrom(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error,\s*/i, ""))
      .filter(Boolean);
    if (msgs.length) return msgs.join(" ");
  }
  return fallback;
}

// Same policy as the backend (validate_password_strength): 12+ chars, upper, lower, digit, special.
function passwordProblem(password: string): string | null {
  if (
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password) ||
    !SPECIAL_CHARS.test(password)
  ) {
    return "Password needs 12+ characters, upper & lower case, a digit, and a special character.";
  }
  if (new TextEncoder().encode(password).length > 72) return "Password is too long (max 72 bytes).";
  return null;
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

// ── Create / edit a recorder ──────────────────────────────────────────────
export function RecorderFormModal({
  mode,
  recorder,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  recorder?: RecorderRecord;
  onClose: () => void;
  onSaved: (saved: RecorderRecord) => void;
}) {
  const isCreate = mode === "create";
  const [name, setName] = useState(recorder?.name ?? "");
  const [username, setUsername] = useState(recorder?.username ?? "");
  const [email, setEmail] = useState(recorder?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!name.trim()) return setError("Please enter a name.");
    if (!username.trim()) return setError("Please enter a username.");
    if (email.trim() && !EMAIL_RE.test(email.trim())) return setError("Please enter a valid email address.");
    if (isCreate) {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
    }

    const body: Record<string, string> = { name: name.trim(), username: username.trim() };
    if (email.trim()) body.email = email.trim();
    if (isCreate) body.password = password;

    setSubmitting(true);
    try {
      const res = await fetch(
        isCreate ? `${BASE_URL}/recorders` : `${BASE_URL}/recorders/${recorder!.user_id}`,
        {
          method: isCreate ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Couldn't save the recorder."));
        return;
      }
      onSaved(data as RecorderRecord);
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isCreate ? "Add recorder" : "Edit recorder"} onClose={onClose} busy={submitting}>
      <form onSubmit={handleSubmit} noValidate>
        {isCreate && (
          <p className={styles.intro}>
            Creates a login with the <strong>Recorder</strong> role.
          </p>
        )}

        <div className={styles.fieldGroup}>
          <label htmlFor="rec-name" className={styles.label}>
            Full name
          </label>
          <input
            id="rec-name"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <div className={styles.fieldGroup}>
            <label htmlFor="rec-username" className={styles.label}>
              Username
            </label>
            <input
              id="rec-username"
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="rec-email" className={styles.label}>
              Email <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="rec-email"
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        {isCreate && (
          <>
            <div className={styles.fieldGroup}>
              <label htmlFor="rec-password" className={styles.label}>
                Password
              </label>
              <input
                id="rec-password"
                type={showPassword ? "text" : "password"}
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <label className={styles.showRow}>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              Show password
            </label>
            <p className={styles.hint}>
              12+ characters with upper &amp; lower case, a digit, and a special character.
            </p>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={submitting}>
            {submitting ? <span className={styles.spinner} /> : isCreate ? "Create recorder" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reset a recorder's password ───────────────────────────────────────────
export function ResetPasswordModal({
  recorder,
  onClose,
}: {
  recorder: RecorderRecord;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const problem = passwordProblem(password);
    if (problem) return setError(problem);

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/recorders/${recorder.user_id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ new_password: password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Couldn't reset the password."));
        return;
      }
      setDone(true);
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Reset password" onClose={onClose} busy={submitting}>
      {done ? (
        <>
          <p className={styles.successText}>
            The password for <strong>{recorder.name}</strong> (@{recorder.username}) has been changed.
            Share the new password with them securely.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <p className={styles.intro}>
            Set a new password for <strong>{recorder.name}</strong> (@{recorder.username}).
          </p>

          <div className={styles.fieldGroup}>
            <label htmlFor="rec-new-password" className={styles.label}>
              New password
            </label>
            <input
              id="rec-new-password"
              type={showPassword ? "text" : "password"}
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </div>
          <label className={styles.showRow}>
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            Show password
          </label>
          <p className={styles.hint}>
            12+ characters with upper &amp; lower case, a digit, and a special character.
          </p>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={submitting}>
              {submitting ? <span className={styles.spinner} /> : "Reset password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}