"use client";

import { useState } from "react";
import styles from "./SignerAccordionItem.module.css";
import { BASE_URL } from "@/config/api";
import type { SignerRecord } from "@/components/CreateSignerModal";

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
  const [photoFailed, setPhotoFailed] = useState(false);

  // Serving endpoint for signer photos doesn't exist yet — this URL is
  // the expected shape once it does. Falls back to initials until then.
  const photoUrl = signer.photo_path ? `${BASE_URL}/signers/${signer.signer_id}/photo` : null;

  return (
    <div className={styles.item}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className={styles.avatar}>
          {photoUrl && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={signer.name}
              className={styles.avatarImg}
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <span className={styles.avatarInitials}>{initials(signer.name)}</span>
          )}
        </div>

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
      )}
    </div>
  );
}