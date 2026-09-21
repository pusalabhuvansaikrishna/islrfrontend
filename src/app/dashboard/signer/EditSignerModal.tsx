"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/components/CreateSignerModal.module.css";
import { BASE_URL } from "@/config/api";
import type { SignerRecord } from "@/components/CreateSignerModal";

type Gender = "MALE" | "FEMALE";

interface EditSignerModalProps {
  signer: SignerRecord;
  onClose: () => void;
  onUpdated: (signer: SignerRecord) => void;
}

export default function EditSignerModal({ signer, onClose, onUpdated }: EditSignerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(signer.name);
  const [age, setAge] = useState(String(signer.age));
  const [gender, setGender] = useState<Gender>(signer.gender);
  const [isDeaf, setIsDeaf] = useState(signer.is_deaf);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existing photo, served once that endpoint exists. Falls back to the
  // placeholder if it 404s or hasn't been built yet.
  const existingPhotoUrl = signer.photo_path ? `${BASE_URL}/signers/${signer.signer_id}/photo` : null;

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!age.trim()) {
      setError("Age is required.");
      return;
    }
    if (Number(age) < 0) {
      setError("Age cannot be negative.");
      return;
    }

    // Only send fields that actually changed — the endpoint is a partial
    // update, so an untouched field is simply left as-is server-side.
    const formData = new FormData();
    if (trimmedName !== signer.name) formData.append("name", trimmedName);
    if (age.trim() !== String(signer.age)) formData.append("age", age.trim());
    if (gender !== signer.gender) formData.append("gender", gender);
    if (isDeaf !== signer.is_deaf) formData.append("is_deaf", String(isDeaf));
    if (photoFile) formData.append("photo", photoFile);

    if ([...formData.keys()].length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/signers/${signer.signer_id}`, {
        method: "PATCH",
        credentials: "include",
        body: formData,
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.detail ?? `Request failed (${res.status})`);
      }

      onUpdated(body as SignerRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the signer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="editSignerTitle">
        <div className={styles.modalHeader}>
          <h3 id="editSignerTitle" className={styles.modalTitle}>
            Edit signer
          </h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.topRow}>
            <div className={styles.fieldsCol}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Name</span>
                <input
                  type="text"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  disabled={submitting}
                  required
                />
              </label>

              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Age</span>
                  <input
                    type="number"
                    min={0}
                    className={styles.input}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Age"
                    disabled={submitting}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Gender</span>
                  <select
                    className={styles.input}
                    value={gender}
                    onChange={(e) => setGender(e.target.value as Gender)}
                    disabled={submitting}
                    required
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </label>
              </div>
            </div>

            <div className={styles.photoCol}>
              <button
                type="button"
                className={styles.photoPicker}
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="New signer photo" className={styles.photoPreviewImg} />
                ) : existingPhotoUrl && !photoFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={existingPhotoUrl}
                    alt={signer.name}
                    className={styles.photoPreviewImg}
                    onError={() => setPhotoFailed(true)}
                  />
                ) : (
                  <span className={styles.photoPlaceholder}>Add photo (optional)</span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoPick}
                className={styles.hiddenFileInput}
                disabled={submitting}
              />
            </div>
          </div>

          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={isDeaf}
              onChange={(e) => setIsDeaf(e.target.checked)}
              disabled={submitting}
              className={styles.checkbox}
            />
            <span>Signer is deaf</span>
          </label>

          {error && <p className={styles.errorText}>{error}</p>}

          <div className={styles.actionsRow}>
            <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}