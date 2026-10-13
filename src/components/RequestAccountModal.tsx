"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./RequestAccountModal.module.css";
import { BASE_URL } from "@/config/api";

const NOTES_MAX = 5000;
const SPECIAL_CHARS = /[!@#$%^&*(),.?":{}|<>]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

type Props = { onClose: () => void };

type FormState = {
  name: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  notes: "",
};

// Mirrors the backend rules so users get instant feedback.
function validate(f: FormState): string | null {
  if (!f.name.trim()) return "Please enter your name.";
  const username = f.username.trim();
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (!USERNAME_RE.test(username))
    return "Username can only contain letters, numbers, '.', '_' and '-'.";
  if (!EMAIL_RE.test(f.email.trim())) return "Please enter a valid email address.";
  if (
    f.password.length < 12 ||
    !/[A-Z]/.test(f.password) ||
    !/[a-z]/.test(f.password) ||
    !/\d/.test(f.password) ||
    !SPECIAL_CHARS.test(f.password)
  ) {
    return "Password needs 12+ characters, upper & lower case, a digit, and a special character.";
  }
  if (new TextEncoder().encode(f.password).length > 72)
    return "Password is too long (max 72 bytes).";
  if (f.password !== f.confirmPassword) return "Passwords do not match.";
  if (f.notes.length > NOTES_MAX) return `Notes must be ${NOTES_MAX} characters or fewer.`;
  return null;
}

// FastAPI returns either a string (409) or a list of validation errors (422).
function extractError(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error,\s*/i, ""))
      .filter(Boolean)
      .join(" ");
  }
  return "Something went wrong. Please try again.";
}

export default function RequestAccountModal({ onClose }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Lock page scroll while the modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape (not while submitting)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, onClose]);

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/account-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
          notes: form.notes.trim() || null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(extractError(data.detail));
        return;
      }

      setSuccessMsg(
        data.message ||
          "Your request has been submitted. You will be able to log in once an admin approves it."
      );
      setForm(EMPTY);
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-title"
      >
        <div className={styles.dialogHeader}>
          <h2 id="request-title" className={styles.title}>
            Request an account
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {successMsg ? (
          <div className={styles.success}>
            <p className={styles.successText}>{successMsg}</p>
            <button type="button" className={styles.primaryBtn} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <p className={styles.intro}>
              Fill in your details. An admin will review your request and choose your access level.
            </p>

            <div className={styles.fieldGroup}>
              <label htmlFor="req-name" className={styles.label}>
                Full name
              </label>
              <input
                id="req-name"
                type="text"
                autoComplete="name"
                autoFocus
                value={form.name}
                onChange={set("name")}
                className={styles.input}
                maxLength={100}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.fieldGroup}>
                <label htmlFor="req-username" className={styles.label}>
                  Username
                </label>
                <input
                  id="req-username"
                  type="text"
                  autoComplete="username"
                  value={form.username}
                  onChange={set("username")}
                  className={styles.input}
                  maxLength={100}
                  spellCheck={false}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="req-email" className={styles.label}>
                  Email
                </label>
                <input
                  id="req-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={set("email")}
                  className={styles.input}
                  maxLength={255}
                  spellCheck={false}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.fieldGroup}>
                <label htmlFor="req-password" className={styles.label}>
                  Password
                </label>
                <input
                  id="req-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={set("password")}
                  className={styles.input}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="req-confirm" className={styles.label}>
                  Confirm password
                </label>
                <input
                  id="req-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  className={styles.input}
                />
              </div>
            </div>
            <p className={styles.hint}>
              12+ characters with upper &amp; lower case, a digit, and a special character.
            </p>

            <div className={styles.fieldGroup}>
              <label htmlFor="req-notes" className={styles.label}>
                Notes <span className={styles.optional}>(optional)</span>
              </label>
              <textarea
                id="req-notes"
                value={form.notes}
                onChange={set("notes")}
                className={styles.textarea}
                rows={4}
                maxLength={NOTES_MAX}
                placeholder="Who you are, why you need access, and any comments"
              />
              <span className={styles.counter}>
                {form.notes.length}/{NOTES_MAX}
              </span>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className={styles.primaryBtn} disabled={loading}>
                {loading ? <span className={styles.spinner} /> : "Submit request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}