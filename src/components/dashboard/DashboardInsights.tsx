"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import styles from "./DashboardInsights.module.css";
import TodaysReportModal from "./TodaysReportModal";
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

// ---------------------------------------------------------------------
// Date helpers. All dates are "YYYY-MM-DD" strings in the viewer's LOCAL
// calendar (not toISOString(), which is UTC and would give the wrong day
// for anyone ahead of/behind UTC -- e.g. India before 5:30 AM).
// ISO date strings compare correctly with plain < and >.
// ---------------------------------------------------------------------

type DateRange = { start: string; end: string }; // "" = unset

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toInputDate(d);
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_LABEL[m - 1]} ${y}`;
}

const ALL_TIME: DateRange = { start: "", end: "" };

const PRESETS: { label: string; build: () => DateRange }[] = [
  { label: "All time", build: () => ALL_TIME },
  { label: "Today", build: () => ({ start: daysAgo(0), end: daysAgo(0) }) },
  { label: "Last 7 days", build: () => ({ start: daysAgo(6), end: daysAgo(0) }) },
  { label: "Last 30 days", build: () => ({ start: daysAgo(29), end: daysAgo(0) }) },
  {
    label: "This month",
    build: () => {
      const now = new Date();
      return {
        start: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: toInputDate(now),
      };
    },
  },
];

export default function DashboardInsightsSection() {
  const { user } = useAuth();

  const [data, setData] = useState<DashboardInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSignerId, setExpandedSignerId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [reportOpen, setReportOpen] = useState(false);

  const canView = user?.permissions?.includes("ReadDashboard") ?? false;
  const isFiltered = range.start !== "" || range.end !== "";
  const isSingleDay = isFiltered && range.start === range.end;
  const today = toInputDate(new Date());

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    setLoading(true);
    setError(null);
    fetchDashboardInsights({
      startDate: range.start || undefined,
      endDate: range.end || undefined,
    })
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

    // If the range changes (or the component unmounts) before this request
    // returns, the stale response is ignored.
    return () => {
      cancelled = true;
    };
  }, [canView, range.start, range.end]);

  // Which preset (if any) matches the current range -> highlighted button.
  const activePreset = useMemo(() => {
    return (
      PRESETS.find((p) => {
        const r = p.build();
        return r.start === range.start && r.end === range.end;
      })?.label ?? null
    );
  }, [range.start, range.end]);

  // Picking a "From" date with no "To" yet selects that single day.
  // Keeping the two inputs consistent (start <= end) happens here, so the
  // API never receives an inverted range.
  function handleStartChange(value: string) {
    if (!value) {
      setRange(ALL_TIME);
      return;
    }
    setRange((prev) => ({
      start: value,
      end: !prev.end || prev.end < value ? value : prev.end,
    }));
  }

  // Clearing "To" collapses back to a single day (the "From" date).
  function handleEndChange(value: string) {
    if (!value) {
      setRange((prev) => ({ start: prev.start, end: prev.start }));
      return;
    }
    setRange((prev) => ({
      start: !prev.start || prev.start > value ? value : prev.start,
      end: value,
    }));
  }

  if (!canView) return null;

  const rangeLabel = !isFiltered
    ? "All time"
    : isSingleDay
      ? formatDisplayDate(range.start)
      : `${formatDisplayDate(range.start)} to ${formatDisplayDate(range.end)}`;

  const periodWord = isFiltered ? "in this period" : "yet";

  // Filter bar + "Today's Report" button, side by side. The modal is
  // rendered here so it is available in every state (loading / error / data).
  const filterBar = (
    <div className={styles.topRow}>
      <section className={styles.filterBar} aria-label="Date filter">
        <div className={styles.segmented} role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`${styles.segment} ${
                activePreset === p.label ? styles.segmentActive : ""
              }`}
              aria-pressed={activePreset === p.label}
              onClick={() => setRange(p.build())}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* One bordered control for the custom range. Pick one date for a
            single day, or both for a span. */}
        <div className={styles.rangeGroup} role="group" aria-label="Custom range">
          <label className={styles.dateField}>
            <span className={styles.dateLabel}>From</span>
            <input
              type="date"
              className={styles.dateInput}
              value={range.start}
              max={range.end || today}
              onChange={(e) => handleStartChange(e.target.value)}
            />
          </label>
          <span className={styles.rangeDash} aria-hidden="true">–</span>
          <label className={styles.dateField}>
            <span className={styles.dateLabel}>To</span>
            <input
              type="date"
              className={styles.dateInput}
              value={range.end}
              min={range.start || undefined}
              max={today}
              onChange={(e) => handleEndChange(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.filterStatus} aria-live="polite">
          <span className={styles.rangeSummary}>
            {rangeLabel}
            {loading && data ? " (updating…)" : ""}
          </span>
          {isFiltered && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => setRange(ALL_TIME)}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <button
        type="button"
        className={styles.reportButton}
        onClick={() => setReportOpen(true)}
        aria-haspopup="dialog"
      >
        Today&rsquo;s Report
      </button>

      {reportOpen && <TodaysReportModal onClose={() => setReportOpen(false)} />}
    </div>
  );

  // First load only: nothing to show yet, but keep the filter visible.
  if (loading && !data) {
    return (
      <div className={styles.wrapper}>
        {filterBar}
        <section className={styles.card}>
          <p className={styles.emptyState}>Loading dashboard insights…</p>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper}>
        {filterBar}
        <section className={styles.card}>
          <p className={styles.errorState}>{error}</p>
        </section>
      </div>
    );
  }

  if (!data) return null;

  const maxStatusCount = Math.max(1, ...data.jobs_per_status.map((s) => s.count));
  const totalJobs = data.jobs_per_status.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={styles.wrapper}>
      {filterBar}

      {/* While a new range is loading, keep the old numbers on screen (dimmed)
          instead of flashing a spinner and losing scroll position. */}
      <div
        className={`${styles.results} ${loading ? styles.refreshing : ""}`}
        aria-busy={loading}
      >
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
                ? `${data.storage.file_count} files${isFiltered ? " in this period" : ""}`
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
            <p className={styles.emptyState}>No jobs {periodWord}.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Status</th>
                    <th>Sentences</th>
                    <th>Sessions{isFiltered ? " (in period)" : ""}</th>
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
            <p className={styles.emptyState}>
              {isFiltered ? "No signer activity in this period." : "No signers yet."}
            </p>
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
                            {/* A month breakdown adds nothing for a single day. */}
                            {!isSingleDay && signer.sessions_per_month.length > 0 && (
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
                        {!isSingleDay && isExpanded && (
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
    </div>
  );
}