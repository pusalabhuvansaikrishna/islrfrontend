"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./JobRequestModals.module.css";
import { BASE_URL } from "@/config/api";
import type { JobRequestRecord, PreviewResponse, PreviewRow } from "./types";

const REASON_MAX = 500;
const PREVIEW_PAGE_SIZE = 50;

function errorFrom(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error,\s*/i, ""))
      .filter(Boolean);
    if (msgs.length) return msgs.join(" ");
  }
  return fallback;
}

// ── Shared modal shell ────────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  busy = false,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.dialogHeader}>
          <h3 className={styles.title}>{title}</h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Approve: confirm, then the job is created ─────────────────────────────
export function ApproveJobModal({
  request,
  onClose,
  onDone,
}: {
  request: JobRequestRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleApprove() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/job-requests/${request.job_request_id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Could not approve this request."));
        return;
      }
      onDone();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Approve job request" onClose={onClose} busy={submitting}>
      <p className={styles.intro}>
        Approve <strong>{request.filename}</strong> from <strong>{request.requested_by}</strong>? A
        job will be created
        {request.row_count != null ? ` with ${request.row_count} sentences` : ""}, and{" "}
        {request.requested_by} will be set as its requestor.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className={styles.primaryBtn} onClick={handleApprove} disabled={submitting}>
          {submitting ? <span className={styles.spinner} /> : "Approve & create job"}
        </button>
      </div>
    </Modal>
  );
}

// ── Deny: optional reason ─────────────────────────────────────────────────
export function DenyJobModal({
  request,
  onClose,
  onDone,
}: {
  request: JobRequestRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDeny() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/job-requests/${request.job_request_id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFrom(data?.detail, "Could not deny this request."));
        return;
      }
      onDone();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Deny job request" onClose={onClose} busy={submitting}>
      <p className={styles.intro}>
        Deny <strong>{request.filename}</strong> from <strong>{request.requested_by}</strong>? No job
        will be created.
      </p>

      <label htmlFor="deny-job-reason" className={styles.label}>
        Reason <span className={styles.optional}>(optional — saved with the request)</span>
      </label>
      <textarea
        id="deny-job-reason"
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <span className={styles.counter}>
        {reason.length}/{REASON_MAX}
      </span>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className={styles.dangerBtn} onClick={handleDeny} disabled={submitting}>
          {submitting ? <span className={styles.spinner} /> : "Deny request"}
        </button>
      </div>
    </Modal>
  );
}

// ── View the uploaded CSV before deciding ─────────────────────────────────
export function CsvPreviewModal({
  request,
  onClose,
}: {
  request: JobRequestRecord;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [total, setTotal] = useState(0); // matching the search
  const [totalRows, setTotalRows] = useState(0); // whole file
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Ignore responses from outdated requests (e.g. while typing in the search box)
  const latestCall = useRef(0);

  async function load(skip: number, term: string, append: boolean) {
    const callId = ++latestCall.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ skip: String(skip), limit: String(PREVIEW_PAGE_SIZE) });
      if (term.trim()) params.set("search", term.trim());

      const res = await fetch(
        `${BASE_URL}/job-requests/${request.job_request_id}/preview?${params.toString()}`,
        { credentials: "include" }
      );
      const data = await res.json().catch(() => null);
      if (callId !== latestCall.current) return;

      if (!res.ok) {
        setError(errorFrom(data?.detail, "Couldn't load the CSV."));
        return;
      }

      const json = data as PreviewResponse;
      setTotal(json.total);
      setTotalRows(json.total_rows);
      setRows((prev) => (append ? [...prev, ...json.items] : json.items));
    } catch {
      if (callId === latestCall.current) setError("Unable to connect to the server.");
    } finally {
      if (callId === latestCall.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  // Load page 1 on open and whenever the (debounced) search changes
  useEffect(() => {
    const t = setTimeout(() => load(0, search, false), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Fetch as a blob so the login cookie is sent, then save it under its real name
  async function handleDownload() {
    setDownloadError("");
    setDownloading(true);
    try {
      const res = await fetch(`${BASE_URL}/job-requests/${request.job_request_id}/csv`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDownloadError(errorFrom(data?.detail, "Couldn't download the file."));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = request.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Unable to connect to the server.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal title={request.filename} onClose={onClose} wide>
      <div className={styles.previewTop}>
        <input
          type="text"
          className={styles.previewSearch}
          placeholder="Search sentences…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sentences"
        />
        <button type="button" className={styles.downloadBtn} onClick={handleDownload} disabled={downloading}>
          {downloading ? "Downloading…" : "Download CSV"}
        </button>
      </div>

      {downloadError && <p className={styles.error}>{downloadError}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {loading && rows.length === 0 && !error && <p className={styles.muted}>Loading…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className={styles.muted}>{search.trim() ? "No sentences match your search." : "This file has no rows."}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colNum}>#</th>
                  <th>Sentence</th>
                  <th className={styles.colSigners}>Signers</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_number}>
                    <td className={styles.colNum}>{r.row_number}</td>
                    <td>{r.text}</td>
                    <td className={styles.colSigners}>{r.required_signer_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.previewFooter}>
            <span>
              Showing {rows.length} of {total}
              {search.trim() ? ` matching (${totalRows} total rows)` : " rows"}
            </span>
            {rows.length < total && (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => load(rows.length, search, true)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}