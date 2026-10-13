"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import styles from "./ResearcherModals.module.css";
import { BASE_URL } from "@/config/api";
import type { ResearcherRecord } from "./types";

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

// ── Create / edit a researcher ──────────────────────────────────────────────
export function ResearcherFormModal({
  mode,
  researcher,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  researcher?: ResearcherRecord;
  onClose: () => void;
  onSaved: (saved: ResearcherRecord) => void;
}) {
  const isCreate = mode === "create";
  const [name, setName] = useState(researcher?.name ?? "");
  const [username, setUsername] = useState(researcher?.username ?? "");
  const [email, setEmail] = useState(researcher?.email ?? "");
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
        isCreate ? `${BASE_URL}/researchers` : `${BASE_URL}/researchers/${researcher!.user_id}`,
        {
          method: isCreate ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Couldn't save the researcher."));
        return;
      }
      onSaved(data as ResearcherRecord);
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isCreate ? "Add researcher" : "Edit researcher"} onClose={onClose} busy={submitting}>
      <form onSubmit={handleSubmit} noValidate>
        {isCreate && (
          <p className={styles.intro}>
            Creates a login with the <strong>Researcher</strong> role.
          </p>
        )}

        <div className={styles.fieldGroup}>
          <label htmlFor="res-name" className={styles.label}>
            Full name
          </label>
          <input
            id="res-name"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <div className={styles.fieldGroup}>
            <label htmlFor="res-username" className={styles.label}>
              Username
            </label>
            <input
              id="res-username"
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="res-email" className={styles.label}>
              Email <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="res-email"
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
              <label htmlFor="res-password" className={styles.label}>
                Password
              </label>
              <input
                id="res-password"
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
            {submitting ? <span className={styles.spinner} /> : isCreate ? "Create researcher" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reset a researcher's password ───────────────────────────────────────────
export function ResetPasswordModal({
  researcher,
  onClose,
}: {
  researcher: ResearcherRecord;
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
      const res = await fetch(`${BASE_URL}/researchers/${researcher.user_id}/reset-password`, {
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
            The password for <strong>{researcher.name}</strong> (@{researcher.username}) has been changed.
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
            Set a new password for <strong>{researcher.name}</strong> (@{researcher.username}).
          </p>

          <div className={styles.fieldGroup}>
            <label htmlFor="res-new-password" className={styles.label}>
              New password
            </label>
            <input
              id="res-new-password"
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