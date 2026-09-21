"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CreateSignerModal.module.css";
import { BASE_URL } from "@/config/api";
import PhotoCaptureModal from "./Photocapturemodal";

type Gender = "MALE" | "FEMALE";

export interface SignerRecord {
  signer_id: string;
  name: string;
  age: number;
  is_deaf: boolean;
  gender: Gender;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateSignerModalProps {
  onClose: () => void;
  onCreated: (signer: SignerRecord) => void;
}

export default function CreateSignerModal({ onClose, onCreated }: CreateSignerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [isDeaf, setIsDeaf] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showCaptureModal, setShowCaptureModal] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revoke the object URL when it's replaced or the modal unmounts.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function setPhoto(file: File) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
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
    if (!gender) {
      setError("Select a gender.");
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

    const formData = new FormData();
    formData.append("name", trimmedName);
    formData.append("gender", gender);
    formData.append("is_deaf", String(isDeaf));
    formData.append("age", age.trim());
    // Whether photoFile came from the manual file picker or was
    // captured via the GoPro modal (see PhotoCaptureModal.onCaptured
    // below), it's a plain File either way -- the backend can't tell
    // the difference and doesn't need to.
    if (photoFile) formData.append("photo", photoFile);

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/signers`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.detail ?? `Request failed (${res.status})`);
      }

      onCreated(body as SignerRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the signer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="createSignerTitle">
        <div className={styles.modalHeader}>
          <h3 id="createSignerTitle" className={styles.modalTitle}>
            Add signer
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
                    <option value="" disabled>
                      Select
                    </option>
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
                onClick={() => setShowCaptureModal(true)}
                disabled={submitting}
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="Signer preview" className={styles.photoPreviewImg} />
                ) : (
                  <span className={styles.photoPlaceholder}>Capture photo</span>
                )}
              </button>
              <button
                type="button"
                className={styles.uploadInsteadLink}
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                or upload a file instead
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
              {submitting ? "Creating…" : "Create signer"}
            </button>
          </div>
        </form>
      </div>

      {showCaptureModal && (
        <PhotoCaptureModal onClose={() => setShowCaptureModal(false)} onCaptured={setPhoto} />
      )}
    </div>
  );
}