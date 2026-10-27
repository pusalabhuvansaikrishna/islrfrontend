"use client";

// Location: src/app/dashboard/annotations/all/page.tsx
//
// Every annotation task raised by any user, newest first, with status and
// assignee. Admin roles can assign / re-assign a task to an annotator and reject
// a pending one. Open tasks can also be ticked and assigned to one annotator in
// one go, from the floating bar at the bottom.
//
// Wired to:
//   GET   /annotation-jobs                   (ApproveAnnotations + admin role)
//   GET   /annotation-jobs/annotators           (ListAnnotators)
//   PATCH /annotation-jobs/{id}/assign       (ApproveAnnotations + admin role)
//   POST  /annotation-jobs/bulk-assign       (ApproveAnnotations + admin role)
//   PATCH /annotation-jobs/{id}/reject       (ApproveAnnotations + admin role)
//
// Click a row's thumbnail to open the review workspace, where notes, tags and
// translations can be added (needs "AnnotateVideo").

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import AnnotationReviewModal from "@/components/annotations/AnnotationReviewModal";
import {
  listAllAnnotations,
  listAnnotators,
  assignAnnotationJob,
  assignAnnotationJobsBulk,
  rejectAnnotationJob,
  takeVideoUrl,
  ApiError,
  type JobStatus,
  type AnnotationJobListItem,
  type Annotator,
} from "@/lib/api";

type StatusFilter = "all" | JobStatus;
type AssignedFilter = "all" | "assigned" | "unassigned";

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

const ASSIGNED_LABEL: Record<AssignedFilter, string> = {
  all: "Any assignee",
  assigned: "Assigned",
  unassigned: "Unassigned",
};

const ASSIGNED_TO_PARAM: Record<AssignedFilter, boolean | undefined> = {
  all: undefined,
  assigned: true,
  unassigned: false,
};

const PAGE_SIZE = 10;

// Must match MAX_BULK_ASSIGN in the backend (annotation_jobs.py).
const MAX_BULK_ASSIGN = 100;

// Mirrors the backend rules: only open tasks can be (re)assigned, only
// pending ones can be rejected.
const canAssign = (status: JobStatus) => status === "PENDING" || status === "PROCESSING";
const canReject = (status: JobStatus) => status === "PENDING";

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

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the ApproveAnnotations permission and the SuperAdmin, Admin or RecorderAdmin role to see all annotation jobs.";
  }
  return errorMessage(err, "Couldn't load annotation jobs.");
}

/** Esc closes the modal, and the page behind it stops scrolling while it's open. */
function useModalBehavior(onClose: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}

export default function AllAnnotationsPage() {
  // Raw text box value vs. the debounced term actually sent to the API.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [assigned, setAssigned] = useState<AssignedFilter>("all");
  const [skip, setSkip] = useState(0);

  const [items, setItems] = useState<AnnotationJobListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which row's modal is open (null = closed).
  const [preview, setPreview] = useState<AnnotationJobListItem | null>(null);
  const [assignTarget, setAssignTarget] = useState<AnnotationJobListItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AnnotationJobListItem | null>(null);

  // Ticked jobs for bulk assign. Lives here so it survives paging.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  // A short confirmation shown above the list after an assign / reject.
  const [notice, setNotice] = useState<string | null>(null);

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

    listAllAnnotations({
      q: searchTerm || undefined,
      status: status === "all" ? undefined : status,
      assigned: ASSIGNED_TO_PARAM[assigned],
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
  }, [searchTerm, status, assigned, skip]);

  function changeStatus(next: StatusFilter) {
    if (next === status) return;
    setStatus(next);
    setSkip(0);
  }

  function changeAssigned(next: AssignedFilter) {
    if (next === assigned) return;
    setAssigned(next);
    setSkip(0);
  }

  /** Swap rows for the server's updated copies, without refetching the page. */
  function replaceItems(updated: AnnotationJobListItem[]) {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((u) => [u.job_id, u]));
    setItems((prev) => (prev ? prev.map((i) => byId.get(i.job_id) ?? i) : prev));

    // A task that is no longer open (e.g. just rejected) can't stay ticked.
    const closed = updated.filter((u) => !canAssign(u.status)).map((u) => u.job_id);
    if (closed.length > 0) {
      setSelected((prev) => {
        if (!closed.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        closed.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  function handleRejected(updated: AnnotationJobListItem) {
    replaceItems([updated]);
    setRejectTarget(null);
    setNotice(`${displayJobId(updated.job_id)} was rejected.`);
  }

  // ---- Single assign ----

  async function submitSingleAssign(item: AnnotationJobListItem, annotator: Annotator) {
    const updated = await assignAnnotationJob(item.job_id, annotator.user_id);
    replaceItems([updated]);
    setAssignTarget(null);
    setNotice(`${displayJobId(updated.job_id)} assigned to ${updated.assigned_to_name ?? annotator.name}.`);
  }

  // ---- Selection / bulk assign ----

  function toggleSelected(jobId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else if (next.size < MAX_BULK_ASSIGN) next.add(jobId);
      return next;
    });
  }

  const assignableOnPage = useMemo(
    () => (items ?? []).filter((i) => canAssign(i.status)).map((i) => i.job_id),
    [items],
  );
  const selectedOnPage = assignableOnPage.filter((id) => selected.has(id)).length;
  const allOnPageSelected = assignableOnPage.length > 0 && selectedOnPage === assignableOnPage.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        assignableOnPage.forEach((id) => next.delete(id));
      } else {
        for (const id of assignableOnPage) {
          if (next.size >= MAX_BULK_ASSIGN) break;
          next.add(id);
        }
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function submitBulkAssign(annotator: Annotator) {
    const ids = Array.from(selected);
    const res = await assignAnnotationJobsBulk(ids, annotator.user_id);

    replaceItems(res.items);
    setSelected(new Set());
    setBulkAssignOpen(false);

    const parts = [`${res.assigned} assigned to ${annotator.name}`];
    if (res.skipped_unchanged > 0) parts.push(`${res.skipped_unchanged} already theirs`);
    if (res.skipped_not_open > 0) parts.push(`${res.skipped_not_open} no longer open`);
    if (res.not_found > 0) parts.push(`${res.not_found} not found`);
    setNotice(parts.join(" · "));
  }

  const selectedCount = selected.size;
  const selectionAtLimit = selectedCount >= MAX_BULK_ASSIGN;

  const rangeStart = total === 0 ? 0 : skip + 1;
  const rangeEnd = Math.min(skip + PAGE_SIZE, total);
  const hasPrev = skip > 0;
  const hasNext = skip + PAGE_SIZE < total;
  const hasFilters = Boolean(searchTerm) || status !== "all" || assigned !== "all";

  return (
    <div className={`${styles.page} ${selectedCount > 0 ? styles.pageWithBar : ""}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>All Annotation Jobs</h1>
        <p className={styles.subtitle}>
          Every annotation task raised by users. Assign a task to an annotator, or reject one that is still pending.
          Tick several open tasks to assign them to the same annotator in one go.
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
        <div className={styles.segmented} aria-label="Assignment">
          {(Object.keys(ASSIGNED_LABEL) as AssignedFilter[]).map((a) => (
            <button
              key={a}
              type="button"
              className={`${styles.segmentButton} ${assigned === a ? styles.segmentButtonActive : ""}`}
              onClick={() => changeAssigned(a)}
            >
              {ASSIGNED_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {error ? (
        <p className={styles.errorText}>{error}</p>
      ) : loading && items === null ? (
        <p className={styles.stateText}>Loading annotation jobs…</p>
      ) : !items || items.length === 0 ? (
        <p className={styles.stateText}>
          {hasFilters ? "No annotation jobs match these filters." : "No annotation jobs have been raised yet."}
        </p>
      ) : (
        <>
          <div className={styles.listToolbar}>
            <label className={styles.selectAll}>
              <RowCheckbox
                checked={allOnPageSelected}
                indeterminate={someOnPageSelected}
                disabled={assignableOnPage.length === 0}
                onChange={toggleAllOnPage}
                label="Select all open jobs on this page"
              />
              <span>Select open jobs on this page</span>
            </label>
            <p className={styles.resultCount}>
              {total} job{total === 1 ? "" : "s"}
            </p>
          </div>

          <ul className={`${styles.list} ${loading ? styles.listLoading : ""}`}>
            {items.map((item) => (
              <JobRow
                key={item.job_id}
                item={item}
                selected={selected.has(item.job_id)}
                onToggleSelected={() => toggleSelected(item.job_id)}
                onPreview={() => setPreview(item)}
                onAssign={() => setAssignTarget(item)}
                onReject={() => setRejectTarget(item)}
              />
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

      {/* Floating bar: appears while jobs are ticked. */}
      {selectedCount > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
          <div className={styles.bulkBarInfo}>
            <span className={styles.bulkBarCount}>
              {selectedCount} job{selectedCount === 1 ? "" : "s"} selected
            </span>
            {selectionAtLimit && <span className={styles.bulkBarNote}>Maximum of {MAX_BULK_ASSIGN} per action</span>}
          </div>
          <div className={styles.bulkBarActions}>
            <button type="button" className={styles.bulkBarClear} onClick={clearSelection}>
              Clear
            </button>
            <button type="button" className={styles.bulkBarPrimary} onClick={() => setBulkAssignOpen(true)}>
              Assign selected
            </button>
          </div>
        </div>
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
      {assignTarget && (
        <AssignModal
          title={`${assignTarget.assigned_to_name ? "Reassign" : "Assign"} annotation job`}
          subtitle={assignTarget.sentence}
          confirmLabel={assignTarget.assigned_to_name ? "Reassign" : "Assign"}
          busyLabel="Assigning…"
          currentAssigneeId={assignTarget.assigned_to_user_id}
          onClose={() => setAssignTarget(null)}
          onSubmit={(annotator) => submitSingleAssign(assignTarget, annotator)}
        />
      )}
      {bulkAssignOpen && (
        <AssignModal
          title={`Assign ${selectedCount} annotation job${selectedCount === 1 ? "" : "s"}`}
          subtitle="All selected tasks will be assigned to the annotator you pick. Tasks that are no longer open are skipped."
          confirmLabel={`Assign ${selectedCount}`}
          busyLabel="Assigning…"
          currentAssigneeId={null}
          onClose={() => setBulkAssignOpen(false)}
          onSubmit={submitBulkAssign}
        />
      )}
      {rejectTarget && (
        <RejectModal item={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={handleRejected} />
      )}
    </div>
  );
}

/** A native checkbox that can show the "some selected" dash. */
function RowCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      title={title}
    />
  );
}

/** One annotation job: checkbox, thumbnail, sentence, who raised it, status, assignee and actions. */
function JobRow({
  item,
  selected,
  onToggleSelected,
  onPreview,
  onAssign,
  onReject,
}: {
  item: AnnotationJobListItem;
  selected: boolean;
  onToggleSelected: () => void;
  onPreview: () => void;
  onAssign: () => void;
  onReject: () => void;
}) {
  const open = canAssign(item.status);

  return (
    <li className={`${styles.row} ${selected ? styles.rowSelected : ""}`}>
      <RowCheckbox
        checked={selected}
        disabled={!open}
        onChange={onToggleSelected}
        label={`Select ${displayJobId(item.job_id)}`}
        title={open ? undefined : "Only pending or in-progress tasks can be assigned"}
      />

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
        {item.assigned_to_name ? (
          <div className={styles.assignee}>
            <span className={styles.assigneeLabel}>Assigned to</span>
            <span className={styles.assigneeName}>{item.assigned_to_name}</span>
            {item.assigned_at && (
              <span className={styles.assigneeMeta}>
                {item.assigned_by_name ? `by ${item.assigned_by_name} · ` : ""}
                {formatDateTime(item.assigned_at)}
              </span>
            )}
          </div>
        ) : (
          <span className={styles.unassigned}>Not assigned yet</span>
        )}

        {(canAssign(item.status) || canReject(item.status)) && (
          <div className={styles.rowActions}>
            {canAssign(item.status) && (
              <button type="button" className={styles.primaryButtonSmall} onClick={onAssign}>
                {item.assigned_to_name ? "Reassign" : "Assign"}
              </button>
            )}
            {canReject(item.status) && (
              <button type="button" className={styles.dangerButtonSmall} onClick={onReject}>
                Reject
              </button>
            )}
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

/**
 * Pick an annotator. Used for assigning one task (or re-assigning it) and for
 * assigning many at once; the caller decides what happens on confirm.
 * `onSubmit` should throw on failure; the message is shown in the modal.
 * On success the caller closes the modal.
 */
function AssignModal({
  title,
  subtitle,
  confirmLabel,
  busyLabel,
  currentAssigneeId,
  onClose,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  confirmLabel: string;
  busyLabel: string;
  /** Pre-selected annotator (single task only); picking them again does nothing. */
  currentAssigneeId: string | null;
  onClose: () => void;
  onSubmit: (annotator: Annotator) => Promise<void>;
}) {
  useModalBehavior(onClose);

  const [annotators, setAnnotators] = useState<Annotator[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(currentAssigneeId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnnotators()
      .then((res) => {
        if (!cancelled) setAnnotators(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? "You need the ListAnnotators permission to see the list of annotators."
            : errorMessage(err, "Couldn't load annotators."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!annotators) return [];
    const term = filter.trim().toLowerCase();
    if (!term) return annotators;
    return annotators.filter((e) =>
      [e.name, e.username, e.email ?? ""].some((field) => field.toLowerCase().includes(term)),
    );
  }, [annotators, filter]);

  const unchanged = selectedId === currentAssigneeId;

  async function submit() {
    const annotator = annotators?.find((a) => a.user_id === selectedId);
    if (!annotator || unchanged || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit(annotator);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't assign."));
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.smallModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <div className={styles.modalTitle}>{title}</div>
            <div className={styles.modalSentence}>{subtitle}</div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className={styles.modalBody}>
          {loadError ? (
            <p className={styles.errorText}>{loadError}</p>
          ) : annotators === null ? (
            <p className={styles.stateText}>Loading annotators…</p>
          ) : annotators.length === 0 ? (
            <p className={styles.stateText}>There are no active annotators to assign to.</p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search annotators…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className={styles.searchInput}
                autoFocus
              />
              <ul className={styles.annotatorList} role="radiogroup" aria-label="Annotators">
                {visible.length === 0 ? (
                  <li className={styles.stateText}>No annotators match “{filter.trim()}”.</li>
                ) : (
                  visible.map((annotator) => {
                    const isSelected = selectedId === annotator.user_id;
                    const isCurrent = currentAssigneeId === annotator.user_id;
                    return (
                      <li key={annotator.user_id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`${styles.annotatorItem} ${isSelected ? styles.annotatorItemActive : ""}`}
                          onClick={() => setSelectedId(annotator.user_id)}
                        >
                          <span className={styles.annotatorName}>
                            {annotator.name}
                            {isCurrent && <span className={styles.currentTag}>Current</span>}
                          </span>
                          <span className={styles.annotatorMeta}>
                            @{annotator.username}
                            {annotator.email ? ` · ${annotator.email}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}

          {saveError && <p className={styles.formError}>{saveError}</p>}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={submit}
            disabled={!selectedId || unchanged || saving}
          >
            {saving ? busyLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Confirm before rejecting a pending task. */
function RejectModal({
  item,
  onClose,
  onRejected,
}: {
  item: AnnotationJobListItem;
  onClose: () => void;
  onRejected: (updated: AnnotationJobListItem) => void;
}) {
  useModalBehavior(onClose);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await rejectAnnotationJob(item.job_id);
      onRejected(updated);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't reject this task."));
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.smallModal}`}
        role="dialog"
        aria-modal="true"
        aria-label="Reject annotation job"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <div className={styles.modalTitle}>Reject this annotation job?</div>
            <div className={styles.modalSentence}>{item.sentence}</div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className={styles.modalBody}>
          <p className={styles.confirmText}>
            Raised by {item.raised_by_name}. Once rejected, the task can no longer be assigned or worked on.
          </p>
          {saveError && <p className={styles.formError}>{saveError}</p>}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.dangerButton} onClick={submit} disabled={saving}>
            {saving ? "Rejecting…" : "Reject"}
          </button>
        </footer>
      </div>
    </div>
  );
}