"use client";

import { useState, type FormEvent } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { UserAccount, CreateUserPayload } from "./types";

interface CreateUserModalProps {
  onClose: () => void;
  onCreated: (user: UserAccount) => void;
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

export default function CreateUserModal({
  onClose,
  onCreated,
}: CreateUserModalProps) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = email.trim().length === 0 || /\S+@\S+\.\S+/.test(email);
  const passwordsMatch = password === confirmPassword;
  const pwError = password.length > 0 ? passwordError(password) : null;
  const isValid =
    name.trim().length > 0 &&
    username.trim().length > 0 &&
    password.length > 0 &&
    !pwError &&
    passwordsMatch &&
    emailValid;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    const payload: CreateUserPayload = {
      name: name.trim(),
      username: username.trim(),
      password,
      ...(email.trim() ? { email: email.trim() } : {}),
    };

    try {
      const created = await apiFetch<UserAccount>("/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(created);
    } catch (err) {
      // Backend returns 409 with a clear "Username is already taken" /
      // "Email is already in use" detail — surface it as-is.
      setError(
        err instanceof ApiError ? err.message : "Couldn't create this user."
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
      aria-labelledby="create-user-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="create-user-title" className={styles.modalTitle}>
            Add user
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
          New accounts are created with the User role.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Lee"
              className={styles.input}
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jordan.lee"
              className={styles.input}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@company.com"
              className={styles.input}
            />
            {!emailValid && (
              <span className={styles.errorText}>
                Enter a valid email address.
              </span>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Password</span>
            <div className={styles.passwordRow}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12+ chars, upper, lower, digit, symbol"
                className={styles.input}
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
            <span className={styles.fieldLabel}>Confirm password</span>
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
              {submitting ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}