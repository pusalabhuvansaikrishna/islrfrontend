"use client";

// Location: src/app/dashboard/annotations/assigned/page.tsx
//
// Annotation tasks assigned to the logged-in user, newest first, with status
// and who raised each one. Read-only: assigning and rejecting happen on the
// "All Annotation Jobs" page.
// Wired to GET /assigned-annotations (needs "SubmitforAnnotation"). The
// backend scopes the list to the caller, so no user is sent from here.
//
// Click a row's thumbnail to open the review workspace, where notes, tags and
// translations can be added (needs "AnnotateVideo").

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import AnnotationReviewModal from "@/components/annotations/AnnotationReviewModal";
import {
  listMyAssignedAnnotations,
  takeVideoUrl,
  ApiError,
  type JobStatus,
  type AnnotationJobListItem,
} from "@/lib/api";

type StatusFilter = "all" | JobStatus;

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  PENDING: "Pending",
  PROCESSING: "In progress",
  COMPLETED: "Completed",
  // A rejected task is currently stored as FAILED.
  FAILED: "Failed / rejected",
};

const STATUS_BADGE_CLASS: Record<JobStatus, string> = {
  PENDING: styles.badgePending,
  PROCESSING: styles.badgeProcessing,
  COMPLETED: styles.badgeCompleted,
  FAILED: styles.badgeFailed,
};

const PAGE_SIZE = 10;

function displayJobId(jobId: string): string {
  return `JOB-${jobId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
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

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the SubmitforAnnotation permission to see the annotations assigned to you.";
  }
  return err instanceof Error && err.message ? err.message : "Couldn't load your assigned annotations.";
}

export default function AssignedAnnotationsPage() {
  // Raw text box value vs. the debounced term actually sent to the API.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [skip, setSkip] = useState(0);

  const [items, setItems] = useState<AnnotationJobListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The row whose video is open in the preview (null = closed).
  const [preview, setPreview] = useState<AnnotationJobListItem | null>(null);

  // Debounce the search box into searchTerm (and go back to page 1).
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setSkip(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Refetch whenever a filter or the page changes. `cancelled` stops a slow
  // earlier request from overwriting a newer one's results.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listMyAssignedAnnotations({
      q: searchTerm || undefined,
      status: status === "all" ? undefined : status,
      skip,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchTerm, status, skip]);

  function changeStatus(next: StatusFilter) {
    if (next === status) return;
    setStatus(next);
    setSkip(0);
  }

  const rangeStart = total === 0 ? 0 : skip + 1;
  const rangeEnd = Math.min(skip + PAGE_SIZE, total);
  const hasPrev = skip > 0;
  const hasNext = skip + PAGE_SIZE < total;
  const hasFilters = Boolean(searchTerm) || status !== "all";

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Assigned Annotations</h1>
        <p className={styles.subtitle}>
          Annotation tasks that have been assigned to you, with their current status and who raised them.
        </p>
      </div>

      <div className={styles.controls}>
        <input
          type="text"
          placeholder="Search by sentence text…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={styles.searchInput}
        />
        <div className={styles.segmented} aria-label="Status">
          {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.segmentButton} ${status === s ? styles.segmentButtonActive : ""}`}
              onClick={() => changeStatus(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={styles.errorText}>{error}</p>
      ) : loading && items === null ? (
        <p className={styles.stateText}>Loading your assigned annotations…</p>
      ) : !items || items.length === 0 ? (
        <p className={styles.stateText}>
          {hasFilters
            ? "No assigned annotations match these filters."
            : "Nothing has been assigned to you yet."}
        </p>
      ) : (
        <>
          <p className={styles.resultCount}>
            {total} task{total === 1 ? "" : "s"}
          </p>

          <ul className={`${styles.list} ${loading ? styles.listLoading : ""}`}>
            {items.map((item) => (
              <AssignedRow key={item.job_id} item={item} onPreview={() => setPreview(item)} />
            ))}
          </ul>

          <div className={styles.pagination}>
            <span className={styles.paginationInfo}>
              Showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className={styles.paginationButtons}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!hasPrev || loading}
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!hasNext || loading}
                onClick={() => setSkip(skip + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {preview && (
        <AnnotationReviewModal
          target={preview}
          extraBadges={
            <span className={`${styles.badge} ${STATUS_BADGE_CLASS[preview.status]}`}>
              Task: {STATUS_LABEL[preview.status]}
            </span>
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/** One assigned task: thumbnail, the sentence, who raised it, and its status. */
function AssignedRow({ item, onPreview }: { item: AnnotationJobListItem; onPreview: () => void }) {
  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.thumbButton}
        onClick={onPreview}
        aria-label={`Open ${item.angle} video`}
      >
        <LazyThumb src={takeVideoUrl(item)} />
        <span className={styles.angleLabel}>{item.angle}</span>
        <span className={styles.durationLabel}>{formatDuration(item.duration_seconds)}</span>
        <span className={styles.playOverlay} aria-hidden="true">
          ▶
        </span>
      </button>

      <div className={styles.rowMain}>
        <div className={styles.sentence}>{item.sentence}</div>
        <div className={styles.rowMeta}>
          <span className={styles.mono}>{displayJobId(item.source_job_id)}</span> · #{item.row_number ?? "—"} · Take{" "}
          {item.take_number}
          <span className={`${styles.miniBadge} ${item.take_is_valid ? styles.miniValid : styles.miniInvalid}`}>
            {item.take_is_valid ? "Valid" : "Invalid"}
          </span>
        </div>
        <div className={styles.rowMeta}>
          Raised by <span className={styles.raisedBy}>{item.raised_by_name}</span> · {formatDateTime(item.created_at)}
        </div>
      </div>

      <div className={styles.rowSide}>
        <span className={`${styles.badge} ${STATUS_BADGE_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
        {item.assigned_at && (
          <div className={styles.assignee}>
            <span className={styles.assigneeLabel}>Assigned</span>
            <span className={styles.assigneeMeta}>
              {item.assigned_by_name ? `by ${item.assigned_by_name} · ` : ""}
              {formatDateTime(item.assigned_at)}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * A thumbnail that only loads its video once it scrolls near the viewport,
 * so a long list doesn't start downloading every clip up front.
 */
function LazyThumb({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);

  return (
    <div ref={ref} className={styles.thumbWrap}>
      {show && (
        <video
          className={styles.thumb}
          // "#t=0.1" asks the browser to show a frame instead of a black box.
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          crossOrigin="use-credentials"
          tabIndex={-1}
        />
      )}
    </div>
  );
}