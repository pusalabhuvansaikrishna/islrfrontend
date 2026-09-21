"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import CreateDatasetModal from "@/components/CreateDatasetModal"; // adjust path to match your project
import { listJobs, ApiError, type Job, type JobStatus } from "@/lib/api";

const STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "In progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

function displayJobId(jobId: string): string {
  // Placeholder short id derived from the UUID until a real sequential
  // job_number field exists on the backend. Not searchable server-side yet.
  return `JOB-${jobId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function JobsPage() {
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-indexed
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the raw input into the value that actually triggers a fetch,
  // and reset to page 0 whenever the search term changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  function loadJobs(pageToLoad: number, term: string) {
    setLoading(true);
    setError(null);
    listJobs({ skip: pageToLoad * PAGE_SIZE, limit: PAGE_SIZE, search: term || undefined })
      .then((res) => {
        setJobs(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load jobs."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  function goToJob(jobId: string) {
    router.push(`/dashboard/jobs/${jobId}`);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, jobId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      goToJob(jobId);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Jobs</h1>

        <div className={styles.headerControls}>
          <div className={styles.searchBox}>
            <svg
              className={styles.searchIcon}
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search CSV file or requestor…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search jobs"
            />
            {searchInput && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          <button type="button" className={styles.createButton} onClick={() => setModalOpen(true)}>
            + Create dataset
          </button>
        </div>
      </div>

      <div className={styles.tableCard}>
        {loading ? (
          <p className={styles.stateText}>Loading jobs…</p>
        ) : error ? (
          <p className={styles.errorText}>{error}</p>
        ) : jobs.length === 0 ? (
          <p className={styles.stateText}>{search ? "No jobs match your search." : "No jobs yet."}</p>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Requestor</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Sessions</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.job_id}
                      onClick={() => goToJob(job.job_id)}
                      onKeyDown={(event) => handleRowKeyDown(event, job.job_id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${displayJobId(job.job_id)}`}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className={styles.jobIdCell}>
                          <span className={styles.jobId}>{displayJobId(job.job_id)}</span>
                          <span className={styles.jobFilename}>{job.filename}</span>
                        </div>
                      </td>
                      <td className={styles.requestorCell}>{job.requestor_name}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles[`status_${job.status.toLowerCase()}`]}`}>
                          <span className={styles.statusDot} />
                          {STATUS_LABEL[job.status]}
                        </span>
                      </td>
                      <td>
                        <div className={styles.progressCell}>
                          <div className={styles.progressTrack}>
                            <div
                              className={`${styles.progressFill} ${job.insights.progress_percent === 100 ? styles.progressFillDone : ""}`}
                              style={{ width: `${job.insights.progress_percent}%` }}
                            />
                          </div>
                          <span className={styles.progressPercent}>{job.insights.progress_percent}%</span>
                        </div>
                      </td>
                      <td className={styles.sessionsCell}>{job.insights.sessions_count}</td>
                      <td className={styles.createdCell}>{formatDate(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <span className={styles.pageRange}>
                {rangeStart}–{rangeEnd} of {total}
              </span>
              <div className={styles.pageButtons}>
                <button
                  type="button"
                  className={styles.pageButton}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!canGoPrev}
                >
                  Previous
                </button>
                <span className={styles.pageIndicator}>
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageButton}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={!canGoNext}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <CreateDatasetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onJobCreated={() => loadJobs(page, search)}
      />
    </div>
  );
}