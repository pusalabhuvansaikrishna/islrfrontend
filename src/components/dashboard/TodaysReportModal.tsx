"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./TodaysReportModal.module.css";
import EmailReportForm from "./EmailReportForm";
import { fetchJobProgress, type JobProgress } from "@/lib/api/jobProgress";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

// Viewer's LOCAL calendar day as YYYY-MM-DD (not toISOString(), which is UTC).
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function completedOnDay(job: JobProgress): number {
  return job.completed_per_day.reduce((sum, d) => sum + d.completed, 0);
}

export default function TodaysReportModal({ onClose }: { onClose: () => void }) {
  // Fixed when the modal opens so the report doesn't shift at midnight.
  const [day] = useState(localToday);
  const [jobs, setJobs] = useState<JobProgress[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showEmail, setShowEmail] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Load (and reload) the report.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJobProgress({ startDate: day, endDate: day })
      .then((res) => {
        if (!cancelled) setJobs(res.jobs);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Something went wrong loading the report.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [day, reloadKey]);

  // Escape closes, page behind doesn't scroll, focus lands on Close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const { visibleJobs, totalToday, activeJobs } = useMemo(() => {
    const all = jobs ?? [];
    const active = all.filter((j) => completedOnDay(j) > 0);
    return {
      visibleJobs: showAll ? all : active,
      totalToday: active.reduce((s, j) => s + completedOnDay(j), 0),
      activeJobs: active.length,
    };
  }, [jobs, showAll]);

  const prettyDay = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="todays-report-title"
      >
        <header className={styles.header}>
          <div>
            <h2 id="todays-report-title" className={styles.title}>
              Today&rsquo;s Report
            </h2>
            <p className={styles.subtitle}>{prettyDay}</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setShowEmail((v) => !v)}
              aria-expanded={showEmail}
            >
              Email report
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              ref={closeRef}
              type="button"
              className={styles.ghostButton}
              onClick={onClose}
              aria-label="Close report"
            >
              Close
            </button>
          </div>
        </header>

        {showEmail && (
          <EmailReportForm
            startDate={day}
            endDate={day}
            onClose={() => setShowEmail(false)}
          />
        )}

        <div className={styles.body} aria-busy={loading}>
          {loading && !jobs ? (
            <p className={styles.muted}>Loading report…</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : (
            <>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <p className={styles.summaryLabel}>Completed today</p>
                  <p className={styles.summaryValue}>{totalToday}</p>
                </div>
                <div className={styles.summaryItem}>
                  <p className={styles.summaryLabel}>Jobs with activity</p>
                  <p className={styles.summaryValue}>{activeJobs}</p>
                </div>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                  />
                  Show jobs with no activity today
                </label>
              </div>

              {visibleJobs.length === 0 ? (
                <p className={styles.muted}>
                  {showAll ? "No jobs yet." : "No transcriptions were completed today."}
                </p>
              ) : (
                <div className={`${styles.jobList} ${loading ? styles.refreshing : ""}`}>
                  {visibleJobs.map((job) => {
                    const today = completedOnDay(job);
                    const pct = job.total_transcriptions
                      ? Math.round((job.completed_total / job.total_transcriptions) * 100)
                      : 0;
                    return (
                      <section className={styles.jobCard} key={job.job_id}>
                        <div className={styles.jobHead}>
                          <h3 className={styles.jobName} title={job.filename}>
                            {job.filename}
                          </h3>
                          <span
                            className={`${styles.pill} ${
                              styles[`status${job.status}`] ?? ""
                            }`}
                          >
                            {STATUS_LABEL[job.status] ?? job.status}
                          </span>
                        </div>

                        <div className={styles.progressRow}>
                          <div className={styles.track}>
                            <div className={styles.bar} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={styles.progressText}>
                            {job.completed_total} / {job.total_transcriptions} ({pct}%)
                          </span>
                        </div>

                        <div className={styles.stats}>
                          <div>
                            <p className={styles.statLabel}>Completed today</p>
                            <p className={styles.statValue}>{today}</p>
                          </div>
                          <div>
                            <p className={styles.statLabel}>Remaining</p>
                            <p className={styles.statValue}>{job.remaining}</p>
                          </div>
                          <div>
                            <p className={styles.statLabel}>Signer recordings still needed</p>
                            <p className={styles.statValue}>{job.signers_still_needed}</p>
                          </div>
                          <div>
                            <p className={styles.statLabel}>Signers contributed</p>
                            <p className={styles.statValue}>{job.signers_count}</p>
                          </div>
                        </div>

                        {job.signers.length > 0 && (
                          <div className={styles.signers}>
                            <p className={styles.statLabel}>
                              Sentences covered per signer (all time)
                            </p>
                            <div className={styles.badgeList}>
                              {job.signers.map((s) => (
                                <span className={styles.badge} key={s.signer_id}>
                                  {s.signer_name}: {s.transcriptions_covered}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}