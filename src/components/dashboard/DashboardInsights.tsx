"use client";

import { Fragment, useEffect, useState } from "react";
import styles from "./DashboardInsights.module.css";
import { useAuth } from "@/lib/auth-context";
import {
  fetchDashboardInsights,
  DashboardApiError,
  type DashboardInsights,
  type JobStatus,
} from "@/lib/api/dashboard";

const STATUS_ORDER: JobStatus[] = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];

const STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const MONTH_LABEL = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export default function DashboardInsightsSection() {
  const { user } = useAuth();

  const [data, setData] = useState<DashboardInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSignerId, setExpandedSignerId] = useState<string | null>(null);

  const canView = user?.permissions?.includes("ReadDashboard") ?? false;

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    setLoading(true);
    setError(null);
    fetchDashboardInsights()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof DashboardApiError
            ? err.message
            : "Something went wrong loading the dashboard.";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canView]);

  if (!canView) return null;

  if (loading) {
    return (
      <section className={styles.card}>
        <p className={styles.emptyState}>Loading dashboard insights…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.card}>
        <p className={styles.errorState}>{error}</p>
      </section>
    );
  }

  if (!data) return null;

  const maxStatusCount = Math.max(1, ...data.jobs_per_status.map((s) => s.count));
  const totalJobs = data.jobs_per_status.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={styles.wrapper}>
      {/* ---- Top-line stats ---- */}
      <section className={styles.statGrid}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Total jobs</p>
          <p className={styles.statValue}>{totalJobs}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Total sentences</p>
          <p className={styles.statValue}>{data.total_sentences}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Total videos</p>
          <p className={styles.statValue}>{data.total_videos}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Avg. sentences per session</p>
          <p className={styles.statValue}>{data.avg_sentences_per_session}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Avg. takes until valid</p>
          <p className={styles.statValue}>{data.avg_takes_to_valid}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Storage used (Raw Files)</p>
          <p className={styles.statValue}>{data.storage.total_size_display}</p>
          <p className={styles.statCaption}>
            {data.storage.raw_files_directory
              ? `${data.storage.file_count} files`
              : "Raw Files folder not configured"}
          </p>
        </div>
      </section>

      {/* ---- Job status funnel ---- */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Jobs by status</h3>
        <div className={styles.funnel}>
          {STATUS_ORDER.map((status) => {
            const entry = data.jobs_per_status.find((s) => s.status === status);
            const count = entry?.count ?? 0;
            const widthPercent = Math.round((count / maxStatusCount) * 100);
            return (
              <div className={styles.funnelRow} key={status}>
                <span className={styles.funnelLabel}>{STATUS_LABEL[status]}</span>
                <div className={styles.funnelTrack}>
                  <div
                    className={`${styles.funnelBar} ${
                      status === "FAILED" ? styles.funnelBarDanger : ""
                    }`}
                    style={{ width: `${widthPercent}%` }}
                  />
                </div>
                <span className={styles.funnelCount}>{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Jobs table ---- */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Jobs</h3>
        {data.jobs.length === 0 ? (
          <p className={styles.emptyState}>No jobs yet.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Sentences</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <tr key={job.job_id}>
                    <td className={styles.filenameCell}>{job.filename}</td>
                    <td>
                      <span
                        className={`${styles.statusPill} ${
                          styles[`status${job.status}`]
                        }`}
                      >
                        {STATUS_LABEL[job.status]}
                      </span>
                    </td>
                    <td>{job.total_transcriptions}</td>
                    <td>{job.total_sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Signers table ---- */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Signer activity</h3>
        {data.signers.length === 0 ? (
          <p className={styles.emptyState}>No signers yet.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Signer</th>
                  <th>Sessions</th>
                  <th>Takes</th>
                  <th>Valid rate</th>
                  <th>Sentences covered</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {data.signers.map((signer) => {
                  const isExpanded = expandedSignerId === signer.signer_id;
                  return (
                    <Fragment key={signer.signer_id}>
                      <tr>
                        <td>{signer.signer_name}</td>
                        <td>{signer.sessions_count}</td>
                        <td>{signer.takes_count}</td>
                        <td>{formatPercent(signer.valid_take_ratio)}</td>
                        <td>{signer.transcriptions_covered}</td>
                        <td>
                          {signer.sessions_per_month.length > 0 && (
                            <button
                              type="button"
                              className={styles.expandButton}
                              onClick={() =>
                                setExpandedSignerId(isExpanded ? null : signer.signer_id)
                              }
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? "Hide months" : "By month"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.monthsRow}>
                          <td colSpan={6}>
                            <div className={styles.monthList}>
                              {signer.sessions_per_month.map((m) => (
                                <span
                                  key={`${m.year}-${m.month}`}
                                  className={styles.monthBadge}
                                >
                                  {MONTH_LABEL[m.month - 1]} {m.year}: {m.session_count}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}