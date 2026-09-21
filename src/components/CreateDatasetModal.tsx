"use client";

import { useEffect, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import styles from "./CreateDatasetModal.module.css";
import {
  listJobs,
  listRequestors,
  createRequestor,
  createJob,
  ApiError,
  type Job,
  type Requestor,
} from "@/lib/api";

const NEW_REQUESTOR_VALUE = "__new__";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JOBS_RAIL_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 350;

interface CreateDatasetModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional extra hook fired after a job is successfully created (e.g. to refresh a page-level list). */
  onJobCreated?: (job: Job) => void;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  PENDING: "Pending",
  PROCESSING: "In progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export default function CreateDatasetModal({ open, onClose, onJobCreated }: CreateDatasetModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [requestorId, setRequestorId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdJob, setCreatedJob] = useState<Job | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [jobsSearchInput, setJobsSearchInput] = useState("");
  const [jobsSearch, setJobsSearch] = useState("");
  const jobsSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [requestors, setRequestors] = useState<Requestor[]>([]);
  const [requestorsLoading, setRequestorsLoading] = useState(false);
  const [requestorsError, setRequestorsError] = useState<string | null>(null);

  const [showNewRequestorModal, setShowNewRequestorModal] = useState(false);
  const [newRequestorName, setNewRequestorName] = useState("");
  const [newRequestorEmail, setNewRequestorEmail] = useState("");
  const [creatingRequestor, setCreatingRequestor] = useState(false);
  const [newRequestorError, setNewRequestorError] = useState<string | null>(null);
  const newRequestorNameRef = useRef<HTMLInputElement>(null);

  function loadJobs(term: string) {
    setJobsLoading(true);
    setJobsError(null);
    return listJobs({ limit: JOBS_RAIL_LIMIT, search: term || undefined })
      .then((res) => setJobs(res.items))
      .catch((err) => setJobsError(err instanceof ApiError ? err.message : "Couldn't load jobs."))
      .finally(() => setJobsLoading(false));
  }

  // Reset transient form state, then load fresh jobs + requestors, whenever the modal opens.
  useEffect(() => {
    if (!open) return;

    setSelectedFile(null);
    setRequestorId("");
    setError(null);
    setSubmitting(false);
    setCreatedJob(null);
    setJobsSearchInput("");
    setJobsSearch("");
    setShowNewRequestorModal(false);
    setNewRequestorName("");
    setNewRequestorEmail("");
    setNewRequestorError(null);

    let cancelled = false;

    setJobsLoading(true);
    setJobsError(null);
    listJobs({ limit: JOBS_RAIL_LIMIT })
      .then((res) => {
        if (!cancelled) setJobs(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setJobsError(err instanceof ApiError ? err.message : "Couldn't load jobs.");
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });

    setRequestorsLoading(true);
    setRequestorsError(null);
    listRequestors({ limit: 100 })
      .then((res) => {
        if (!cancelled) setRequestors(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setRequestorsError(err instanceof ApiError ? err.message : "Couldn't load requestors.");
      })
      .finally(() => {
        if (!cancelled) setRequestorsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounce the jobs-rail search input into the value that actually triggers a fetch.
  useEffect(() => {
    if (!open) return;
    if (jobsSearchDebounceRef.current) clearTimeout(jobsSearchDebounceRef.current);
    jobsSearchDebounceRef.current = setTimeout(() => {
      setJobsSearch(jobsSearchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (jobsSearchDebounceRef.current) clearTimeout(jobsSearchDebounceRef.current);
    };
  }, [jobsSearchInput, open]);

  // Re-fetch the jobs rail whenever the debounced search term changes (skip the
  // very first render per-open, since the open-effect above already loaded it).
  const didMountJobsSearch = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!didMountJobsSearch.current) {
      didMountJobsSearch.current = true;
      return;
    }
    loadJobs(jobsSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsSearch]);

  useEffect(() => {
    if (open) didMountJobsSearch.current = false;
  }, [open]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Close on Escape. The nested "new requestor" modal takes priority when it's open.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (showNewRequestorModal) {
        cancelNewRequestor();
      } else {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, showNewRequestorModal]);

  // Focus the name field when the new-requestor modal opens.
  useEffect(() => {
    if (showNewRequestorModal) {
      const id = requestAnimationFrame(() => newRequestorNameRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [showNewRequestorModal]);

  if (!open) return null;

  function pickFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    setError(null);
    setSelectedFile(file);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    pickFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleRequestorSelectChange(value: string) {
    if (value === NEW_REQUESTOR_VALUE) {
      setNewRequestorName("");
      setNewRequestorEmail("");
      setNewRequestorError(null);
      setShowNewRequestorModal(true);
      return;
    }
    setRequestorId(value);
  }

  function cancelNewRequestor() {
    if (creatingRequestor) return;
    setShowNewRequestorModal(false);
    setNewRequestorName("");
    setNewRequestorEmail("");
    setNewRequestorError(null);
  }

  async function handleSaveNewRequestor() {
    const name = newRequestorName.trim();
    const email = newRequestorEmail.trim();

    if (!name) {
      setNewRequestorError("Name is required.");
      return;
    }
    if (!email) {
      setNewRequestorError("Email is required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setNewRequestorError("Please enter a valid email address.");
      return;
    }

    setCreatingRequestor(true);
    setNewRequestorError(null);
    try {
      const created = await createRequestor({ name, email });
      setRequestors((prev) => [created, ...prev]);
      setRequestorId(created.requestor_id);
      setShowNewRequestorModal(false);
      setNewRequestorName("");
      setNewRequestorEmail("");
    } catch (err) {
      setNewRequestorError(err instanceof ApiError ? err.message : "Couldn't create requestor.");
    } finally {
      setCreatingRequestor(false);
    }
  }

  const canProcess = Boolean(selectedFile && requestorId) && !submitting;

  async function handleProcess() {
    if (!selectedFile || !requestorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await createJob({ file: selectedFile, requestorId });
      setCreatedJob(job);
      setSelectedFile(null);
      setRequestorId("");
      onJobCreated?.(job);
      loadJobs(jobsSearch); // refresh the left rail so the new job shows up, keeping any active search
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong while processing. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreateAnother() {
    setCreatedJob(null);
    setError(null);
  }

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-dataset-title">
        <div className={styles.modalHeader}>
          <h2 id="create-dataset-title" className={styles.modalTitle}>
            Create dataset
          </h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <aside className={styles.jobsRail}>
            <div className={styles.jobsRailHeader}>Existing jobs</div>

            <div className={styles.jobsSearchBox}>
              <svg
                className={styles.jobsSearchIcon}
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className={styles.jobsSearchInput}
                placeholder="Search CSV file or requestor…"
                value={jobsSearchInput}
                onChange={(event) => setJobsSearchInput(event.target.value)}
                aria-label="Search existing jobs"
              />
              {jobsSearchInput && (
                <button
                  type="button"
                  className={styles.jobsSearchClear}
                  onClick={() => setJobsSearchInput("")}
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <div className={styles.jobsList}>
              {jobsLoading ? (
                <p className={styles.jobsEmpty}>Loading jobs…</p>
              ) : jobsError ? (
                <p className={styles.errorText}>{jobsError}</p>
              ) : jobs.length === 0 ? (
                <p className={styles.jobsEmpty}>{jobsSearch ? "No jobs match your search." : "No jobs yet."}</p>
              ) : (
                jobs.map((job) => (
                  <div key={job.job_id} className={styles.jobCard}>
                    <div className={styles.jobCardTop}>
                      <span className={styles.jobFilename} title={job.filename}>
                        {job.filename}
                      </span>
                      <span className={`${styles.statusBadge} ${styles[`status_${job.status.toLowerCase()}`]}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                    </div>
                    <div className={styles.jobCardMeta}>
                      <span>{job.requestor_name}</span>
                      <span>{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className={styles.jobCardProgress}>
                      <div className={styles.progressTrack}>
                        <div
                          className={`${styles.progressFill} ${job.insights.progress_percent === 100 ? styles.progressFillDone : ""}`}
                          style={{ width: `${job.insights.progress_percent}%` }}
                        />
                      </div>
                      <span className={styles.progressLabel}>
                        {job.insights.completed_sentences}/{job.insights.total_sentences} sentences ·{" "}
                        {job.insights.sessions_count} sessions
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <div className={styles.mainPanel}>
            {createdJob ? (
              <div className={styles.successPanel}>
                <div className={styles.successIcon}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className={styles.successTitle}>Dataset created</h3>
                <p className={styles.successMeta}>
                  {createdJob.filename} · {createdJob.insights.total_sentences} sentences · requestor{" "}
                  {createdJob.requestor_name}
                </p>
                <p className={styles.successHint}>
                  The job has been queued and now shows up in the list on the left.
                </p>
                <button type="button" className={styles.cancelButton} onClick={handleCreateAnother}>
                  Create another dataset
                </button>
              </div>
            ) : (
              <>
                <section className={styles.uploadPanel}>
                  <div className={styles.panelLabel}>Upload CSV</div>
                  <div
                    className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""} ${selectedFile ? styles.dropzoneFilled : ""}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileInputChange}
                      className={styles.hiddenInput}
                    />
                    {selectedFile ? (
                      <div className={styles.fileChosen}>
                        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true">
                          <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                          <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                        <div>
                          <p className={styles.fileName}>{selectedFile.name}</p>
                          <p className={styles.fileHint}>Click or drop to replace</p>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.dropHint}>
                        <svg viewBox="0 0 20 20" width="22" height="22" fill="none" aria-hidden="true">
                          <path d="M10 13V4M10 4L6.5 7.5M10 4l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        <p>
                          Drag a .csv file here, or <span className={styles.browseLink}>browse</span>
                        </p>
                        <p className={styles.fileHint}>Two columns: sentence, signers required</p>
                      </div>
                    )}
                  </div>
                </section>

                <section className={styles.requestorPanel}>
                  <div className={styles.panelLabel}>Requestor</div>
                  <select
                    className={styles.select}
                    value={requestorId}
                    onChange={(event) => handleRequestorSelectChange(event.target.value)}
                    disabled={requestorsLoading || Boolean(requestorsError)}
                  >
                    <option value="" disabled>
                      {requestorsLoading
                        ? "Loading requestors…"
                        : requestorsError
                          ? "Couldn't load requestors"
                          : "Select a requestor"}
                    </option>
                    {requestors.map((r) => (
                      <option key={r.requestor_id} value={r.requestor_id}>
                        {r.name}
                        {r.email ? ` — ${r.email}` : ""}
                      </option>
                    ))}
                    <option value={NEW_REQUESTOR_VALUE}>+ Add new requestor</option>
                  </select>
                  {requestorsError && <p className={styles.errorText}>{requestorsError}</p>}
                  {error && <p className={styles.errorText}>{error}</p>}
                </section>
              </>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          {createdJob ? (
            <button type="button" className={styles.processButton} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className={styles.cancelButton} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.processButton} onClick={handleProcess} disabled={!canProcess}>
                {submitting ? "Processing…" : "Process"}
              </button>
            </>
          )}
        </div>
      </div>

      {showNewRequestorModal && (
        <div
          className={styles.subOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelNewRequestor();
          }}
        >
          <div
            className={styles.subModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-requestor-title"
          >
            <div className={styles.modalHeader}>
              <h3 id="new-requestor-title" className={styles.modalTitle}>
                Add new requestor
              </h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={cancelNewRequestor}
                aria-label="Close"
              >
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className={styles.subModalBody}>
              <label className={styles.fieldLabel} htmlFor="new-requestor-name">
                Name
              </label>
              <input
                id="new-requestor-name"
                ref={newRequestorNameRef}
                type="text"
                className={styles.select}
                placeholder="Requestor name"
                value={newRequestorName}
                onChange={(event) => setNewRequestorName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSaveNewRequestor();
                }}
              />

              <label className={styles.fieldLabel} htmlFor="new-requestor-email">
                Email
              </label>
              <input
                id="new-requestor-email"
                type="email"
                className={styles.select}
                placeholder="Requestor email"
                value={newRequestorEmail}
                onChange={(event) => setNewRequestorEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSaveNewRequestor();
                }}
              />

              {newRequestorError && <p className={styles.errorText}>{newRequestorError}</p>}
            </div>

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={cancelNewRequestor}
                disabled={creatingRequestor}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.processButton}
                onClick={handleSaveNewRequestor}
                disabled={creatingRequestor}
              >
                {creatingRequestor ? "Saving…" : "Save requestor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}