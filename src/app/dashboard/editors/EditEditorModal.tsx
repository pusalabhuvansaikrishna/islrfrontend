"use client";

import { useState, type FormEvent } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { Editor, UpdateEditorPayload } from "./types";

interface EditEditorModalProps {
  editor: Editor;
  onClose: () => void;
  onUpdated: (editor: Editor) => void;
}

export default function EditEditorModal({
  editor,
  onClose,
  onUpdated,
}: EditEditorModalProps) {
  const [name, setName] = useState(editor.name);
  const [username, setUsername] = useState(editor.username);
  const [email, setEmail] = useState(editor.email ?? "");
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

    const payload: UpdateEditorPayload = {
      name: name.trim(),
      username: username.trim(),
      email: email.trim(),
    };

    try {
      const updated = await apiFetch<Editor>(`/editors/${editor.user_id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't update this editor."
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
      aria-labelledby="edit-editor-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="edit-editor-title" className={styles.modalTitle}>
            Edit editor
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
          Update details for <strong>{editor.username}</strong>.
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