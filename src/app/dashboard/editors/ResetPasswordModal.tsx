"use client";

import { useState, type FormEvent } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { Editor, ResetPasswordPayload } from "./types";

interface ResetPasswordModalProps {
  editor: Editor;
  onClose: () => void;
  onReset: () => void;
}

// Mirrors the backend's _validate_password_strength: 12+ chars, upper,
// lower, digit, special character. Keep in sync with security.py.
const SPECIAL_CHARS = /[!@#$%^&*(),.?":{}|<>]/;

function passwordError(password: string): string | null {
  if (password.length < 12) return "At least 12 characters.";
  if (!/[A-Z]/.test(password)) return "Needs an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Needs a lowercase letter.";
  if (!/\d/.test(password)) return "Needs a digit.";
  if (!SPECIAL_CHARS.test(password)) return "Needs a special character.";
  return null;
}

export default function ResetPasswordModal({
  editor,
  onClose,
  onReset,
}: ResetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = password === confirmPassword;
  const pwError = password.length > 0 ? passwordError(password) : null;
  const isValid = password.length > 0 && !pwError && passwordsMatch;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    const payload: ResetPasswordPayload = { new_password: password };

    try {
      await apiFetch<{ detail: string }>(
        `/editors/${editor.user_id}/reset-password`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      onReset();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't reset the password."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-password-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="reset-password-title" className={styles.modalTitle}>
            Reset password
          </h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className={styles.subtitle}>
          Set a new password for <strong>{editor.username}</strong>. They'll
          need to sign in with it next time.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>New password</span>
            <div className={styles.passwordRow}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12+ chars, upper, lower, digit, symbol"
                className={styles.input}
                autoFocus
              />
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {pwError && <span className={styles.errorText}>{pwError}</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Confirm new password</span>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className={styles.input}
            />
            {!passwordsMatch && confirmPassword.length > 0 && (
              <span className={styles.errorText}>Passwords don't match.</span>
            )}
          </label>

          {error && <p className={styles.errorText}>{error}</p>}

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={!isValid || submitting}
            >
              {submitting ? "Resetting…" : "Reset password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}