"use client";

// Location: src/app/dashboard/jobs/[job_id]/StartSessionModal.tsx
//
// Signer field is live: it searches GET /signers and lets the user create a
// new signer inline via the shared CreateSignerModal.
//
// There is no Recorder field — the person starting the session IS the
// recorder. The backend fills recorded_by_user_id from the authenticated
// caller (see createSession() in lib/api.ts), so the client only sends
// signer_id and session_datetime.
//
// Session creation is wired to POST /jobs/{job_id}/sessions via
// createSession() in lib/api.ts.
//
// Once a signer is selected, we check GET
// /jobs/{job_id}/signers/{signer_id}/pending-transcriptions to see if
// they've already completed every transcription in this job. If so, we
// disable submission and explain why, rather than letting the user hit
// the backend's 400 blind. The backend still enforces this on POST — this
// check is just an earlier, friendlier warning.

import { useEffect, useRef, useState } from "react";
import styles from "./StartSessionModal.module.css";
import {
  listSigners,
  createSession,
  listSignerPendingTranscriptions,
  ApiError,
  type SignerRecord,
  type SessionRow,
} from "@/lib/api";
import CreateSignerModal from "@/components/CreateSignerModal";

type StartSessionModalProps = {
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
  // Called after the session is successfully created on the backend, with
  // the created session so the parent can optimistically update its list.
  onCreated?: (session: SessionRow) => void;
};

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function StartSessionModal({ jobId, isOpen, onClose, onCreated }: StartSessionModalProps) {
  const [sessionDatetime, setSessionDatetime] = useState(() => toDatetimeLocalValue(new Date()));

  // ---- Signer combobox state ----
  const [selectedSigner, setSelectedSigner] = useState<SignerRecord | null>(null);
  const [signerDropdownOpen, setSignerDropdownOpen] = useState(false);
  const [signerQuery, setSignerQuery] = useState("");
  const [signerResults, setSignerResults] = useState<SignerRecord[] | null>(null);
  const [signerLoading, setSignerLoading] = useState(false);
  const [signerError, setSignerError] = useState<string | null>(null);
  const [showCreateSigner, setShowCreateSigner] = useState(false);

  // ---- Selected signer's remaining work in this job ----
  // null = not checked yet / not applicable, a number = pending count.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCheckFailed, setPendingCheckFailed] = useState(false);

  // ---- Submit state ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const signerFieldRef = useRef<HTMLDivElement>(null);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedSigner(null);
    setSessionDatetime(toDatetimeLocalValue(new Date()));
    setSignerDropdownOpen(false);
    setSignerQuery("");
    setSignerResults(null);
    setPendingCount(null);
    setPendingLoading(false);
    setPendingCheckFailed(false);
    setSubmitting(false);
    setSubmitError(null);
  }, [isOpen]);

  // Fetch signers when the dropdown opens, and again (debounced) as the
  // user types a search term.
  useEffect(() => {
    if (!signerDropdownOpen) return;

    const handle = setTimeout(
      () => {
        setSignerLoading(true);
        setSignerError(null);
        listSigners({ limit: 100, search: signerQuery || undefined })
          .then((res) => setSignerResults(res.items))
          .catch((err) => setSignerError(err instanceof ApiError ? err.message : "Couldn't load signers."))
          .finally(() => setSignerLoading(false));
      },
      signerQuery ? 300 : 0
    );
    return () => clearTimeout(handle);
  }, [signerDropdownOpen, signerQuery]);

  // Close the signer dropdown when clicking outside it.
  useEffect(() => {
    if (!signerDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (signerFieldRef.current && !signerFieldRef.current.contains(e.target as Node)) {
        setSignerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [signerDropdownOpen]);

  // Whenever a signer is selected, check how many transcriptions in this
  // job they still have left. limit: 1 — we only need the `total` count,
  // not the actual rows.
  useEffect(() => {
    if (!selectedSigner) {
      setPendingCount(null);
      setPendingCheckFailed(false);
      return;
    }

    let cancelled = false;
    setPendingLoading(true);
    setPendingCheckFailed(false);

    listSignerPendingTranscriptions(jobId, selectedSigner.signer_id, { limit: 1 })
      .then((res) => {
        if (cancelled) return;
        setPendingCount(res.total);
      })
      .catch(() => {
        if (cancelled) return;
        // Don't block the user on this check failing — the backend still
        // enforces the rule on submit either way. Just skip the warning.
        setPendingCheckFailed(true);
        setPendingCount(null);
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, selectedSigner]);

  if (!isOpen) return null;

  const signerIsComplete = pendingCount === 0;
  const canSubmit =
    !!selectedSigner && !!sessionDatetime && !submitting && !pendingLoading && !signerIsComplete;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSigner || !sessionDatetime || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createSession(jobId, {
        signerId: selectedSigner.signer_id,
        // datetime-local gives a value like "2026-09-18T14:42" in the
        // browser's local time zone — convert to a real ISO instant for
        // the backend.
        sessionDatetime: new Date(sessionDatetime).toISOString(),
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Couldn't start session. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSignerCreated(signer: SignerRecord) {
    setSelectedSigner(signer);
    setSignerResults((prev) => (prev ? [signer, ...prev] : [signer]));
    setShowCreateSigner(false);
    setSignerDropdownOpen(false);
  }

  return (
    <>
      <div className={styles.overlay} onClick={submitting ? undefined : onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className={styles.header}>
            <h2 className={styles.title}>Start session</h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
              disabled={submitting}
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className={styles.field} ref={signerFieldRef}>
              <label className={styles.label} htmlFor="signer-combo-button">
                Signer
              </label>
              <button
                type="button"
                id="signer-combo-button"
                className={styles.comboButton}
                onClick={() => setSignerDropdownOpen((open) => !open)}
                disabled={submitting}
              >
                <span className={selectedSigner ? undefined : styles.comboPlaceholder}>
                  {selectedSigner ? selectedSigner.name : "Select a signer…"}
                </span>
                <span aria-hidden="true">▾</span>
              </button>

              {signerDropdownOpen && (
                <div className={styles.comboPanel}>
                  <input
                    type="text"
                    className={styles.comboSearchInput}
                    placeholder="Search signers…"
                    value={signerQuery}
                    onChange={(e) => setSignerQuery(e.target.value)}
                    autoFocus
                  />

                  <div className={styles.comboList}>
                    {signerLoading ? (
                      <p className={styles.comboState}>Loading…</p>
                    ) : signerError ? (
                      <p className={styles.comboStateError}>{signerError}</p>
                    ) : !signerResults || signerResults.length === 0 ? (
                      <p className={styles.comboState}>No signers found.</p>
                    ) : (
                      signerResults.map((s) => (
                        <button
                          key={s.signer_id}
                          type="button"
                          className={styles.comboItem}
                          onClick={() => {
                            setSelectedSigner(s);
                            setSignerDropdownOpen(false);
                          }}
                        >
                          {s.name}
                          <span className={styles.comboItemMeta}>
                            {s.age} · {s.gender === "MALE" ? "Male" : "Female"}
                            {s.is_deaf ? " · Deaf" : ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  <button
                    type="button"
                    className={styles.comboCreateBtn}
                    onClick={() => setShowCreateSigner(true)}
                  >
                    + Add signer
                  </button>
                </div>
              )}

              {selectedSigner && pendingLoading && (
                <p className={styles.comboState}>Checking remaining work for this signer…</p>
              )}
              {selectedSigner && !pendingLoading && signerIsComplete && (
                <p className={styles.submitError}>
                  {selectedSigner.name} has already completed every transcription in this job. Please choose
                  a different signer.
                </p>
              )}
              {selectedSigner && !pendingLoading && !signerIsComplete && pendingCount !== null && (
                <p className={styles.comboState}>
                  {pendingCount} transcription{pendingCount === 1 ? "" : "s"} remaining for{" "}
                  {selectedSigner.name} in this job.
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="session-datetime">
                Date &amp; time
              </label>
              <input
                id="session-datetime"
                type="datetime-local"
                className={styles.input}
                value={sessionDatetime}
                onChange={(e) => setSessionDatetime(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            {submitError && <p className={styles.submitError}>{submitError}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                {submitting ? "Starting…" : "Start session"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showCreateSigner && (
        <CreateSignerModal onClose={() => setShowCreateSigner(false)} onCreated={handleSignerCreated} />
      )}
    </>
  );
}