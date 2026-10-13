"use client";

// Location: src/app/dashboard/assigned-sessions/page.tsx

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import {
  listMyAssignedSessions,
  ApiError,
  type AssignedSession,
} from "@/lib/api";

type StatusFilter = "open" | "ended" | "all";

const FILTER_LABEL: Record<StatusFilter, string> = {
  open: "Open",
  ended: "Ended",
  all: "All",
};

const PAGE_SIZE = 20;

function displayJobId(jobId: string): string {
  // Same placeholder scheme as the jobs pages.
  return `JOB-${jobId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function displaySessionId(sessionId: string): string {
  return `SES-${sessionId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AssignedSessionsPage() {
  const router = useRouter();

  const [filter, setFilter] = useState<StatusFilter>("open");
  const [page, setPage] = useState(0);

  const [sessions, setSessions] = useState<AssignedSession[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetch whenever the filter or page changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listMyAssignedSessions({
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      ended: filter === "all" ? undefined : filter === "ended",
    })
      .then((res) => {
        if (cancelled) return;
        setSessions(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load assigned sessions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  function changeFilter(next: StatusFilter) {
    if (next === filter) return;
    setFilter(next);
    setPage(0);
  }

  function openSession(s: AssignedSession) {
    router.push(`/dashboard/jobs/${s.job_id}/sessions/${s.session_id}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Assigned Sessions</h1>
          <p className={styles.subtitle}>
            Sessions assigned to you. Open one to start recording.
          </p>
        </div>
      </div>

      <div className={styles.tabs}>
        {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.tabButton} ${filter === f ? styles.tabButtonActive : ""}`}
            onClick={() => changeFilter(f)}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {loading && sessions === null ? (
        <p className={styles.stateText}>Loading assigned sessions…</p>
      ) : error ? (
        <p className={styles.errorText}>{error}</p>
      ) : !sessions || sessions.length === 0 ? (
        <p className={styles.stateText}>
          {filter === "open"
            ? "You have no open sessions assigned to you."
            : filter === "ended"
            ? "You have no ended sessions."
            : "No sessions have been assigned to you yet."}
        </p>
      ) : (
        <>
          <div className={`${styles.tableScroll} ${loading ? styles.tableLoading : ""}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Job</th>
                  <th>Requestor</th>
                  <th>Signer</th>
                  <th>Assigned by</th>
                  <th>Date &amp; time</th>
                  <th>Transcriptions</th>
                  <th>Takes</th>
                  <th>Status</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isEnded = !!s.ended_at;
                  return (
                    <tr
                      key={s.session_id}
                      onClick={() => openSession(s)}
                      className={styles.clickableRow}
                    >
                      <td className={styles.mono}>{displaySessionId(s.session_id)}</td>
                      <td>
                        <div className={styles.jobCell}>
                          <span className={styles.mono}>{displayJobId(s.job_id)}</span>
                          <span className={styles.jobFile}>{s.job_filename}</span>
                        </div>
                      </td>
                      <td>{s.requestor_name}</td>
                      <td>{s.signer_name}</td>
                      <td>{s.assigned_by_name ?? "—"}</td>
                      <td>{formatDateTime(s.session_datetime)}</td>
                      <td>{s.transcription_count}</td>
                      <td>{s.takes_count}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            isEnded ? styles.badgeEnded : styles.badgeOpen
                          }`}
                        >
                          {isEnded ? "Ended" : "Open"}
                        </span>
                      </td>
                      <td className={styles.actionCell}>
                        <button
                          type="button"
                          className={isEnded ? styles.secondaryButton : styles.primaryButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSession(s);
                          }}
                        >
                          {isEnded ? "View" : "Record"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span className={styles.paginationInfo}>
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className={styles.paginationButtons}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className={styles.paginationInfo}>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page + 1 >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}