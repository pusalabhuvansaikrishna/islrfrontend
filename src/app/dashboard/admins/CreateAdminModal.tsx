"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { apiFetch, ApiError } from "./api";
import type { Admin, CreateAdminPayload } from "./types";

interface CreateAdminModalProps {
  onClose: () => void;
  onCreated: (admin: Admin) => void;
}

export default function CreateAdminModal({
  onClose,
  onCreated,
}: CreateAdminModalProps) {
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
  const isValid =
    name.trim().length > 0 &&
    username.trim().length > 0 &&
    password.length >= 8 &&
    passwordsMatch &&
    emailValid;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    const payload: CreateAdminPayload = {
      name: name.trim(),
      username: username.trim(),
      password,
      ...(email.trim() ? { email: email.trim() } : {}),
    };

    try {
      const created = await apiFetch<Admin>("/admins", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(created);
    } catch (err) {
      // Backend returns 409 with a clear "Username is already taken" /
      // "Email is already in use" detail — surface it as-is.
      setError(
        err instanceof ApiError ? err.message : "Couldn't create this admin."
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
      aria-labelledby="create-admin-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="create-admin-title" className={styles.modalTitle}>
            Add admin
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
          New accounts are created with the Admin role.
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
                placeholder="At least 8 characters"
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
              {submitting ? "Creating…" : "Create admin"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}