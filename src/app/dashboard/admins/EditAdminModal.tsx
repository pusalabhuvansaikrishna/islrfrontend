"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { apiFetch, ApiError } from "./api";
import type { Admin, UpdateAdminPayload } from "./types";

interface EditAdminModalProps {
  admin: Admin;
  onClose: () => void;
  onUpdated: (admin: Admin) => void;
}

export default function EditAdminModal({
  admin,
  onClose,
  onUpdated,
}: EditAdminModalProps) {
  const [name, setName] = useState(admin.name);
  const [username, setUsername] = useState(admin.username);
  const [email, setEmail] = useState(admin.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = email.trim().length === 0 || /\S+@\S+\.\S+/.test(email);
  const isValid =
    name.trim().length > 0 && username.trim().length > 0 && emailValid;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    const payload: UpdateAdminPayload = {
      name: name.trim(),
      username: username.trim(),
      email: email.trim(),
    };

    try {
      const updated = await apiFetch<Admin>(`/admins/${admin.user_id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't update this admin."
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
      aria-labelledby="edit-admin-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="edit-admin-title" className={styles.modalTitle}>
            Edit admin
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
          Update details for <strong>{admin.username}</strong>.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              className={styles.input}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
            />
            {!emailValid && (
              <span className={styles.errorText}>
                Enter a valid email address.
              </span>
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}