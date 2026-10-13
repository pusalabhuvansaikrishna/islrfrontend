"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";
import { ApproveJobModal, DenyJobModal, CsvPreviewModal } from "./JobRequestModals";
import type { JobRequestRecord, RequestStatus, StatusFilter } from "./types";

const PAGE_SIZE = 20;

type ViewState = "loading" | "ready" | "unauthorized" | "error";
type Reviewing = { kind: "approve" | "deny" | "preview"; request: JobRequestRecord } | null;

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "All", value: "ALL" },
];

const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function JobRequestsPage() {
  const [requests, setRequests] = useState<JobRequestRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<Reviewing>(null);

  // Ignore responses from outdated requests (e.g. user switches tabs quickly)
  const latestCall = useRef(0);

  const canApprove = permissions.includes("ApproveJobRequests");
  const canReject = permissions.includes("RejectJobRequests");

  // Buttons only show for people who hold the permission. The server enforces
  // this too, so this is just to keep the UI tidy.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/me`, { credentials: "include" });
        if (!res.ok) return;
        const me: { permissions?: string[] } = await res.json();
        setPermissions(me.permissions ?? []);
      } catch {
        /* buttons simply stay hidden */
      }
    })();
  }, []);

  const fetchRequests = useCallback(
    async (page: number, searchTerm: string, filter: StatusFilter, append: boolean) => {
      const callId = ++latestCall.current;
      if (append) setLoadingMore(true);
      else setViewState("loading");
      setErrorText(null);

      try {
        const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
        if (filter !== "ALL") params.set("status", filter);
        if (searchTerm.trim()) params.set("search", searchTerm.trim());

        const res = await fetch(`${BASE_URL}/job-requests?${params.toString()}`, {
          credentials: "include",
        });

        if (callId !== latestCall.current) return;

        if (res.status === 403) {
          setViewState("unauthorized");
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`
          );
        }

        const json: { total: number; items: JobRequestRecord[] } = await res.json();
        if (callId !== latestCall.current) return;

        setTotal(json.total);
        setRequests((prev) => (append ? [...prev, ...json.items] : json.items));
        setViewState("ready");
      } catch (err) {
        if (callId !== latestCall.current) return;
        setErrorText(err instanceof Error ? err.message : "Failed to load job requests");
        setViewState("error");
      } finally {
        if (callId === latestCall.current) setLoadingMore(false);
      }
    },
    []
  );

  // Reload from page 1 whenever the search or status tab changes (search is debounced)
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchRequests(1, search, statusFilter, false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, statusFilter, fetchRequests]);

  function handleLoadMore() {
    const nextPage = Math.floor(requests.length / PAGE_SIZE) + 1;
    fetchRequests(nextPage, search, statusFilter, true);
  }

  // After approving / denying, reload from page 1 so the list and the
  // paging stay consistent with the server.
  function handleReviewed() {
    setReviewing(null);
    fetchRequests(1, search, statusFilter, false);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Job requests</h2>
        {viewState === "ready" && (
          <span className={styles.count}>
            {total} {total === 1 ? "request" : "requests"}
          </span>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.value}
              className={`${styles.tab} ${statusFilter === f.value ? styles.tabActive : ""}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by file or requester…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {viewState === "unauthorized" && (
        <p className={styles.stateText}>You don&apos;t have permission to view job requests.</p>
      )}

      {viewState === "error" && <p className={styles.errorText}>{errorText}</p>}

      {viewState === "loading" && requests.length === 0 && (
        <p className={styles.stateText}>Loading job requests…</p>
      )}

      {viewState === "ready" && requests.length === 0 && (
        <p className={styles.stateText}>No job requests found.</p>
      )}

      {requests.length > 0 && (
        <div className={styles.list}>
          {requests.map((r) => (
            <RequestItem
              key={r.job_request_id}
              request={r}
              canApprove={canApprove}
              canReject={canReject}
              onView={(req) => setReviewing({ kind: "preview", request: req })}
              onApprove={(req) => setReviewing({ kind: "approve", request: req })}
              onDeny={(req) => setReviewing({ kind: "deny", request: req })}
            />
          ))}
        </div>
      )}

      {requests.length > 0 && requests.length < total && (
        <button
          type="button"
          className={styles.loadMoreBtn}
          onClick={handleLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : `Load more (${requests.length} of ${total})`}
        </button>
      )}

      {reviewing?.kind === "preview" && (
        <CsvPreviewModal request={reviewing.request} onClose={() => setReviewing(null)} />
      )}

      {reviewing?.kind === "approve" && (
        <ApproveJobModal
          request={reviewing.request}
          onClose={() => setReviewing(null)}
          onDone={handleReviewed}
        />
      )}

      {reviewing?.kind === "deny" && (
        <DenyJobModal
          request={reviewing.request}
          onClose={() => setReviewing(null)}
          onDone={handleReviewed}
        />
      )}
    </div>
  );
}

function RequestItem({
  request: r,
  canApprove,
  canReject,
  onView,
  onApprove,
  onDeny,
}: {
  request: JobRequestRecord;
  canApprove: boolean;
  canReject: boolean;
  onView: (r: JobRequestRecord) => void;
  onApprove: (r: JobRequestRecord) => void;
  onDeny: (r: JobRequestRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `job-request-${r.job_request_id}`;
  const isPending = r.status === "PENDING";

  return (
    <div className={styles.item}>
      <div className={styles.itemTop}>
        <button
          type="button"
          className={styles.itemHeader}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
        >
          <span className={styles.itemMain}>
            <span className={styles.itemName}>{r.filename}</span>
            <span className={styles.itemSub}>
              {r.requested_by}
              {r.row_count != null ? ` · ${r.row_count} sentences` : ""}
            </span>
          </span>

          <span className={styles.itemMeta}>
            <span className={`${styles.badge} ${styles[`badge${r.status}`]}`}>
              {STATUS_LABEL[r.status]}
            </span>
            <span className={styles.itemDate}>{formatDate(r.created_at)}</span>
            <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true">
              ▾
            </span>
          </span>
        </button>

        <div className={styles.itemActions}>
          <button type="button" className={styles.viewBtn} onClick={() => onView(r)}>
            View CSV
          </button>
          {isPending && canReject && (
            <button type="button" className={styles.denyBtn} onClick={() => onDeny(r)}>
              Deny
            </button>
          )}
          {isPending && canApprove && (
            <button type="button" className={styles.approveBtn} onClick={() => onApprove(r)}>
              Approve
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id={panelId} className={styles.itemBody}>
          <dl className={styles.details}>
            <dt>File</dt>
            <dd>{r.filename}</dd>
            <dt>Sentences</dt>
            <dd>{r.row_count ?? "—"}</dd>
            <dt>Requested by</dt>
            <dd>
              {r.requested_by}
              {r.requested_by_email ? ` (${r.requested_by_email})` : ""}
            </dd>
            <dt>Requested</dt>
            <dd>{formatDate(r.created_at)}</dd>
          </dl>

          <div className={styles.notesBlock}>
            <p className={styles.notesLabel}>Notes</p>
            {r.notes ? (
              <p className={styles.notes}>{r.notes}</p>
            ) : (
              <p className={styles.notesEmpty}>No notes provided.</p>
            )}
          </div>

          {!isPending && (
            <dl className={`${styles.details} ${styles.reviewBlock}`}>
              <dt>Reviewed by</dt>
              <dd>{r.reviewed_by ?? "—"}</dd>
              <dt>Reviewed at</dt>
              <dd>{formatDate(r.reviewed_at)}</dd>
              {r.status === "APPROVED" && (
                <>
                  <dt>Job</dt>
                  <dd>
                    {r.created_job_id ? (
                      <Link href={`/dashboard/jobs/${r.created_job_id}`} className={styles.jobLink}>
                        Open job
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </>
              )}
              {r.status === "REJECTED" && (
                <>
                  <dt>Reason</dt>
                  <dd>{r.rejection_reason ?? "—"}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}