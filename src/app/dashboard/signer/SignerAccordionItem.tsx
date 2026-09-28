"use client";

import { useState } from "react";
import styles from "./SignerAccordionItem.module.css";
import type { SignerRecord } from "@/components/CreateSignerModal";
import { useSignerPhoto } from "@/hooks/useSignerPhoto";

interface SignerAccordionItemProps {
  signer: SignerRecord;
  onEdit?: (signer: SignerRecord) => void;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SignerAccordionItem({ signer, onEdit }: SignerAccordionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const { photoUrl, failed } = useSignerPhoto(signer.signer_id, Boolean(signer.photo_path));
  const hasUsablePhoto = Boolean(photoUrl) && !failed;

  return (
    <div className={styles.item}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Only shown while collapsed -- once expanded, the same photo is
            already visible below in the larger square format, so showing
            it again here would just be the same image twice. */}
        {!expanded && (
          <div className={styles.avatar}>
            {hasUsablePhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl!} alt={signer.name} className={styles.avatarImg} />
            ) : (
              <span className={styles.avatarInitials}>{initials(signer.name)}</span>
            )}
          </div>
        )}

        <div className={styles.headerText}>
          <span className={styles.name}>{signer.name}</span>
          <span className={styles.subline}>
            {signer.gender === "MALE" ? "Male" : "Female"}
            {signer.age != null ? ` · ${signer.age} yrs` : ""}
          </span>
        </div>

        {signer.is_deaf && <span className={styles.badge}>Deaf</span>}

        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}>⌄</span>
      </button>

      {expanded && (
        <div className={styles.details}>
          <div className={styles.detailsLayout}>
            <div className={styles.detailsPhotoCol}>
              {hasUsablePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl!} alt={signer.name} className={styles.detailsPhotoImg} />
              ) : (
                <div className={styles.detailsPhotoPlaceholder}>{initials(signer.name)}</div>
              )}
            </div>

            <div className={styles.detailsMainCol}>
              <div className={styles.detailGrid}>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Age</span>
                  <span className={styles.detailValue}>{signer.age ?? "—"}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Gender</span>
                  <span className={styles.detailValue}>{signer.gender === "MALE" ? "Male" : "Female"}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Deaf</span>
                  <span className={styles.detailValue}>{signer.is_deaf ? "Yes" : "No"}</span>
                </div>
                <div className={styles.detailField}>
                  <span className={styles.detailLabel}>Added</span>
                  <span className={styles.detailValue}>{formatDate(signer.created_at)}</span>
                </div>
              </div>

              <div className={styles.detailActions}>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => onEdit?.(signer)}
                  disabled={!onEdit}
                  title={onEdit ? "Edit signer" : "Editing isn't available yet"}
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}