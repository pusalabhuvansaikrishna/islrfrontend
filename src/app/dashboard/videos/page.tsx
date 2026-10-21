"use client";

// Location: src/app/dashboard/videos/page.tsx
//
// Hierarchy shown on this page:
//   sentence (transcription)
//     └─ take (take_id)  -- Valid / Invalid, session badge, signer
//          └─ videos     -- one tile per camera angle, with its annotation status
//
// The modal is a review workspace for one video at a time:
//   - player with speed / loop controls, or all angles of the take side by side
//   - previous / next video across everything on the page (buttons or ← →)
//   - notes / tags / translations on the right, with one-click tag suggestions
//
// "Submit for annotation" (POST /videos/{id}/annotation-jobs) is available on
// every video tile and in the modal's side panel.
//
// Filters: sentence text, take validity, CSV file (= Record job, filtered on the
// server so paging stays correct) and annotation status (client-side, this page only).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./page.module.css";
import {
  searchTakeVideos,
  listVideoJobs,
  takeVideoUrl,
  addVideoNote,
  addVideoTags,
  addVideoTranslation,
  getTranslationKeys,
  submitVideoForAnnotation,
  downloadTakeVideo,
  ApiError,
  type JobStatus,
  type VideoJob,
  type VideoAnnotationStatus,
  type TranscriptionGroup,
  type VideoTake,
  type TakeVideo,
  type VideoNote,
  type VideoTag,
  type Translation,
  type TranslationKey,
} from "@/lib/api";

type ValidityFilter = "all" | "valid" | "invalid";
type AnnotationFilter = "all" | "todo" | "done";

const VALIDITY_LABEL: Record<ValidityFilter, string> = {
  all: "All takes",
  valid: "Valid",
  invalid: "Invalid",
};

const VALIDITY_TO_PARAM: Record<ValidityFilter, boolean | undefined> = {
  all: undefined,
  valid: true,
  invalid: false,
};

const ANNOTATION_LABEL: Record<AnnotationFilter, string> = {
  all: "Any video",
  todo: "Not annotated",
  done: "Annotated",
};

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.5];

// Paging is over sentences, and each sentence can hold many takes.
const PAGE_SIZE = 5;

// Value of the CSV dropdown when no file is selected.
const ALL_CSV = "all";

function displayJobId(jobId: string): string {
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

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A stable colour per session, so takes from the same session look alike at a glance. */
function sessionHue(sessionId: string): number {
  let h = 0;
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * A stable colour per tag name (case-insensitive), so "Blurry" is the same
 * colour on every video. FNV-1a spreads similar names ("camera1", "camera2")
 * far apart on the colour wheel, which a simple sum would not.
 */
function tagHue(name: string): number {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

type VideoChange = (video: TakeVideo) => Partial<TakeVideo>;

/** One video together with the take and sentence it belongs to. */
type Entry = { group: TranscriptionGroup; take: VideoTake; video: TakeVideo };

/**
 * Everything the "Submit for annotation" buttons need, created once in the
 * page and handed down to the tiles and the modal. Whether a video has
 * already been submitted comes from the video itself (`video.annotation`,
 * which the API returns), so it survives a reload.
 *   submitting - requests currently in flight
 *   errors     - last error message per video
 */
type SubmitControl = {
  submitting: Set<string>;
  errors: Record<string, string>;
  onSubmit: (videoId: string) => void;
};

function annotationCount(v: TakeVideo): number {
  return v.notes.length + v.tags.length + v.translations.length;
}

function flatten(groups: TranscriptionGroup[]): Entry[] {
  const out: Entry[] = [];
  for (const group of groups) {
    for (const take of group.takes) {
      for (const video of take.videos) out.push({ group, take, video });
    }
  }
  return out;
}

/**
 * Applies the "annotated / not annotated" filter to what is already loaded.
 * The video open in the modal is always kept, so annotating it doesn't make it
 * vanish from the previous / next list while you're still looking at it.
 */
function filterGroups(
  groups: TranscriptionGroup[],
  filter: AnnotationFilter,
  keepVideoId: string | null,
): TranscriptionGroup[] {
  if (filter === "all") return groups;
  const keep = (v: TakeVideo) =>
    v.video_id === keepVideoId || (filter === "todo" ? annotationCount(v) === 0 : annotationCount(v) > 0);
  return groups
    .map((g) => ({
      ...g,
      takes: g.takes.map((t) => ({ ...t, videos: t.videos.filter(keep) })).filter((t) => t.videos.length > 0),
    }))
    .filter((g) => g.takes.length > 0);
}

function submitErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the SubmitforAnnotation permission to do this.";
  }
  return err instanceof Error && err.message ? err.message : "Couldn't submit the video for annotation.";
}

const ANNOTATION_STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "In progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const ANNOTATION_STATUS_CLASS: Record<JobStatus, string> = {
  PENDING: styles.annPending,
  PROCESSING: styles.annProcessing,
  COMPLETED: styles.annCompleted,
  FAILED: styles.annFailed,
};

/** An annotation job that is still open (the backend refuses a second one). */
function isActiveAnnotation(a: VideoAnnotationStatus | null | undefined): boolean {
  return !!a && (a.status === "PENDING" || a.status === "PROCESSING");
}

/**
 * What to show for a video's annotation request:
 *  - an open request (pending / in progress): just the status badge, nothing to click
 *  - no request, or a finished one (completed / failed): the Submit button,
 *    preceded by the last request's status badge when there is one
 */
function SubmitAction({
  video,
  submit,
  compact = false,
}: {
  video: TakeVideo;
  submit: SubmitControl;
  compact?: boolean;
}) {
  const { annotation } = video;
  const busy = submit.submitting.has(video.video_id);
  const active = isActiveAnnotation(annotation);

  const badge = annotation ? (
    <span
      className={`${styles.annBadge} ${ANNOTATION_STATUS_CLASS[annotation.status]}`}
      title={
        `Submitted for annotation by ${annotation.raised_by_name} on ${formatDateTime(annotation.created_at)}` +
        (annotation.assigned_to_name ? ` · assigned to ${annotation.assigned_to_name}` : " · not assigned yet")
      }
    >
      {active ? "✓ Submitted for annotation" : "Last request"} · {ANNOTATION_STATUS_LABEL[annotation.status]}
    </span>
  ) : null;

  if (active) return badge;

  return (
    <>
      {badge}
      <button
        type="button"
        className={`${styles.submitButton} ${compact ? styles.submitButtonCompact : ""}`}
        disabled={busy}
        onClick={() => submit.onSubmit(video.video_id)}
        title="Raise an annotation task for this video"
      >
        {busy ? "Submitting…" : annotation ? "Submit again" : "Submit for annotation"}
      </button>
    </>
  );
}

/** File name (without extension) used when the server doesn't send one. */
function downloadName(take: VideoTake, video: TakeVideo): string {
  return `take${take.take_number}_${video.angle}_${video.video_id.slice(0, 8)}`.replace(/[^\w.-]+/g, "_");
}

/**
 * Downloads one video's file. Keeps its own busy / error state. The button is
 * only busy for the quick preflight check; after that the browser's own
 * download manager takes over and shows the progress.
 *   compact - the smaller size used under tiles
 *   inBar   - placed in the modal's playback bar (pushed to the far right)
 */
function DownloadButton({
  take,
  video,
  compact = false,
  inBar = false,
}: {
  take: VideoTake;
  video: TakeVideo;
  compact?: boolean;
  inBar?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadTakeVideo(video, downloadName(take, video));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't download the video.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.downloadButton} ${compact ? styles.downloadButtonCompact : ""} ${inBar ? styles.downloadButtonBar : ""}`}
        disabled={busy}
        onClick={() => void download()}
        title={`Download the ${video.angle} video`}
      >
        {busy ? (
          <span className={styles.downloadSpinner} aria-hidden="true" />
        ) : (
          <svg
            className={styles.downloadIcon}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2v8.5M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11" />
          </svg>
        )}
        {busy ? "Starting…" : "Download"}
      </button>
      {error && <p className={styles.downloadError}>{error}</p>}
    </>
  );
}

export default function VideosPage() {
  // Raw text box value vs. the debounced term actually sent to the API.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [validity, setValidity] = useState<ValidityFilter>("all");
  const [annotation, setAnnotation] = useState<AnnotationFilter>("all");
  const [skip, setSkip] = useState(0);

  // CSV file filter: the selected file's job_id (or ALL_CSV), plus the list for the dropdown.
  const [jobId, setJobId] = useState<string>(ALL_CSV);
  const [csvFiles, setCsvFiles] = useState<VideoJob[]>([]);

  const [groups, setGroups] = useState<TranscriptionGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The video open in the modal (null = closed). Only the id is kept; the modal
  // reads live data from `groups`, so a note added there shows up immediately.
  const [openId, setOpenId] = useState<string | null>(null);

  // "Submit for annotation" state, shared by the tiles and the modal.
  // Bumped to re-run the search (e.g. after a 409, to pick up the existing request's status).
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState<Set<string>>(new Set());
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});

  // Load the CSV files once, for the dropdown.
  useEffect(() => {
    let cancelled = false;
    listVideoJobs()
      .then((rows) => {
        if (!cancelled) setCsvFiles(rows);
      })
      .catch(() => {
        if (!cancelled) setCsvFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the search box into searchTerm (and go back to page 1).
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setSkip(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Refetch whenever the term, validity, CSV file or page changes. `cancelled` stops a
  // slow earlier request from overwriting a newer one's results.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    searchTakeVideos({
      q: searchTerm || undefined,
      isValid: VALIDITY_TO_PARAM[validity],
      jobId: jobId === ALL_CSV ? undefined : jobId,
      skip,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setGroups(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load videos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchTerm, validity, jobId, skip, reloadKey]);

  function handleValidityChange(next: ValidityFilter) {
    if (next === validity) return;
    setValidity(next);
    setSkip(0);
  }

  function handleJobChange(next: string) {
    if (next === jobId) return;
    setJobId(next);
    setSkip(0);
    setOpenId(null);
  }

  // ---- Local updates after a successful add, so the UI changes without a refetch ----

  function updateVideo(videoId: string, change: VideoChange) {
    setGroups(
      (prev) =>
        prev &&
        prev.map((g) => ({
          ...g,
          takes: g.takes.map((t) => ({
            ...t,
            videos: t.videos.map((v) => (v.video_id === videoId ? { ...v, ...change(v) } : v)),
          })),
        })),
    );
  }

  function handleTranslationAdded(videoId: string, translation: Translation) {
    updateVideo(videoId, (v) => ({
      translations: [...v.translations, translation].sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }

  // ---- Submit for annotation ----

  async function handleSubmitForAnnotation(videoId: string) {
    if (submitting.has(videoId)) return;

    setSubmitting((prev) => new Set(prev).add(videoId));
    setSubmitErrors((prev) => {
      const { [videoId]: _removed, ...rest } = prev;
      return rest;
    });

    try {
      const job = await submitVideoForAnnotation(videoId);
      // Show the new request on the video straight away.
      updateVideo(videoId, () => ({
        annotation: {
          job_id: job.job_id,
          status: job.status,
          created_at: job.created_at,
          raised_by_name: job.raised_by_name,
          assigned_to_name: job.assigned_to_name,
        },
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone already raised an open request for this video: reload to show it.
        setReloadKey((k) => k + 1);
      } else {
        setSubmitErrors((prev) => ({ ...prev, [videoId]: submitErrorMessage(err) }));
      }
    } finally {
      setSubmitting((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  }

  const submitControl: SubmitControl = {
    submitting,
    errors: submitErrors,
    onSubmit: (id) => void handleSubmitForAnnotation(id),
  };

  // ---- Derived data ----

  const allEntries = useMemo(() => flatten(groups ?? []), [groups]);
  const visibleGroups = useMemo(
    () => filterGroups(groups ?? [], annotation, openId),
    [groups, annotation, openId],
  );
  const navList = useMemo(() => flatten(visibleGroups), [visibleGroups]);

  const openEntry = openId ? allEntries.find((e) => e.video.video_id === openId) : undefined;

  // Annotation progress per sentence, from the unfiltered data so it stays honest under a filter.
  const progressByTranscription = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const e of allEntries) {
      const id = e.group.transcription.transcription_id;
      const p = map.get(id) ?? { done: 0, total: 0 };
      p.total += 1;
      if (annotationCount(e.video) > 0) p.done += 1;
      map.set(id, p);
    }
    return map;
  }, [allEntries]);

  const videosOnPage = allEntries.length;
  const todoOnPage = allEntries.filter((e) => annotationCount(e.video) === 0).length;

  // Tags already used on this page, most common first: one-click suggestions in the modal.
  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const e of allEntries) {
      for (const t of e.video.tags) {
        const k = t.name.toLowerCase();
        const cur = counts.get(k);
        if (cur) cur.n += 1;
        else counts.set(k, { name: t.name, n: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.name);
  }, [allEntries]);

  const rangeStart = total === 0 ? 0 : skip + 1;
  const rangeEnd = Math.min(skip + PAGE_SIZE, total);
  const hasPrev = skip > 0;
  const hasNext = skip + PAGE_SIZE < total;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Videos</h1>
        <p className={styles.subtitle}>
          Search by sentence text or pick a CSV file, then open a video to review it. Inside the viewer use ← → to move
          between videos, Space to play or pause, and add notes, tags and translations on the right.
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
        <div className={styles.selectWrap}>
          <select
            className={styles.select}
            value={jobId}
            onChange={(e) => handleJobChange(e.target.value)}
            aria-label="Filter by CSV file"
          >
            <option value={ALL_CSV}>All CSV files</option>
            {csvFiles.map((f) => (
              <option key={f.job_id} value={f.job_id}>
                {f.filename} · {displayJobId(f.job_id)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.segmented} aria-label="Take validity">
          {(Object.keys(VALIDITY_LABEL) as ValidityFilter[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`${styles.segmentButton} ${validity === v ? styles.segmentButtonActive : ""}`}
              onClick={() => handleValidityChange(v)}
            >
              {VALIDITY_LABEL[v]}
            </button>
          ))}
        </div>
        <div className={styles.segmented} aria-label="Annotation status (this page)">
          {(Object.keys(ANNOTATION_LABEL) as AnnotationFilter[]).map((a) => (
            <button
              key={a}
              type="button"
              className={`${styles.segmentButton} ${annotation === a ? styles.segmentButtonActive : ""}`}
              onClick={() => setAnnotation(a)}
            >
              {ANNOTATION_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={styles.errorText}>{error}</p>
      ) : loading && groups === null ? (
        <p className={styles.stateText}>Loading videos…</p>
      ) : !groups || groups.length === 0 ? (
        <p className={styles.stateText}>
          {searchTerm
            ? `No takes found for "${searchTerm}".`
            : jobId !== ALL_CSV
              ? "No recorded takes found for this CSV file."
              : "No recorded takes found."}
        </p>
      ) : (
        <>
          <p className={styles.resultCount}>
            {total} sentence{total === 1 ? "" : "s"} found · {videosOnPage} video{videosOnPage === 1 ? "" : "s"} on this
            page ·{" "}
            <span className={todoOnPage > 0 ? styles.todoText : undefined}>{todoOnPage} not annotated yet</span>
          </p>

          {visibleGroups.length === 0 ? (
            <p className={styles.stateText}>
              {annotation === "todo"
                ? "Every video on this page already has annotations. 🎉"
                : "No annotated videos on this page."}
            </p>
          ) : (
            <div className={`${styles.groups} ${loading ? styles.groupsLoading : ""}`}>
              {visibleGroups.map((group) => (
                <SentenceGroup
                  key={group.transcription.transcription_id}
                  group={group}
                  progress={progressByTranscription.get(group.transcription.transcription_id)}
                  submit={submitControl}
                  onOpenVideo={(video) => setOpenId(video.video_id)}
                />
              ))}
            </div>
          )}

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

      {openEntry && (
        <ReviewModal
          entry={openEntry}
          list={navList}
          tagSuggestions={tagSuggestions}
          submit={submitControl}
          onSelect={setOpenId}
          onVideoChange={updateVideo}
          onTranslationAdded={handleTranslationAdded}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Level 1: one sentence, with all of its takes underneath. */
function SentenceGroup({
  group,
  progress,
  submit,
  onOpenVideo,
}: {
  group: TranscriptionGroup;
  progress: { done: number; total: number } | undefined;
  submit: SubmitControl;
  onOpenVideo: (video: TakeVideo) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { transcription, job } = group;
  const complete = progress ? progress.total > 0 && progress.done === progress.total : false;

  return (
    <section className={styles.group}>
      <header className={styles.groupHeader}>
        <div className={styles.groupHeaderMain}>
          <div className={styles.sentence}>{transcription.text}</div>
          <div className={styles.groupMeta}>
            <span className={styles.mono}>{displayJobId(job.job_id)}</span> · {job.filename} · {job.requestor_name} · #
            {transcription.row_number ?? "—"} · needs {transcription.required_signer_count} signer
            {transcription.required_signer_count === 1 ? "" : "s"}
          </div>
        </div>
        <div className={styles.groupHeaderSide}>
          <span className={styles.countText}>
            {group.take_count} take{group.take_count === 1 ? "" : "s"} · {group.valid_take_count} valid
          </span>
          {progress && (
            <span className={`${styles.progressText} ${complete ? styles.progressDone : ""}`}>
              {progress.done}/{progress.total} videos annotated
            </span>
          )}
          <button type="button" className={styles.collapseButton} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? "Show takes" : "Hide takes"}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className={styles.takes}>
          {group.takes.map((take) => (
            <TakeRow key={take.take_id} take={take} submit={submit} onOpenVideo={onOpenVideo} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The session a take was recorded in, as a coloured badge. Take numbers restart
 * in every session, so "Take 1" can appear several times for one sentence; the
 * badge (same colour = same session) is what tells those takes apart.
 */
function SessionBadge({ take }: { take: VideoTake }) {
  const { session } = take;
  return (
    <span
      className={styles.sessionBadge}
      style={{ "--hue": sessionHue(session.session_id) } as CSSProperties}
      title={`Session ${displaySessionId(session.session_id)} · ${formatDateTime(session.session_datetime)} · recorded by ${session.recorder_name}`}
    >
      {displaySessionId(session.session_id)}
    </span>
  );
}

/** Level 2: one take, with a tile for each of its camera angles. */
function TakeRow({
  take,
  submit,
  onOpenVideo,
}: {
  take: VideoTake;
  submit: SubmitControl;
  onOpenVideo: (video: TakeVideo) => void;
}) {
  return (
    <div className={`${styles.take} ${take.is_valid ? "" : styles.takeInvalid}`}>
      <div className={styles.takeHeader}>
        <span className={styles.takeTitle}>Take {take.take_number}</span>
        <span className={`${styles.badge} ${take.is_valid ? styles.badgeValid : styles.badgeInvalid}`}>
          {take.is_valid ? "Valid" : "Invalid"}
        </span>
        <SessionBadge take={take} />
        <span className={styles.takeMeta}>
          {take.signer.name} · {formatDateTime(take.created_at)}
        </span>
      </div>

      {take.videos.length === 0 ? (
        <p className={styles.noVideos}>No videos for this take.</p>
      ) : (
        <div className={styles.tiles}>
          {take.videos.map((v) => (
            <VideoTile key={v.video_id} take={take} video={v} submit={submit} onOpen={() => onOpenVideo(v)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A thumbnail that only loads its video once it scrolls near the viewport.
 * A page can hold dozens of videos, and loading all of them up front is slow.
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

/** Level 3: one camera angle -- a still frame, what has been added to it, and its annotation request. */
function VideoTile({
  take,
  video,
  submit,
  onOpen,
}: {
  take: VideoTake;
  video: TakeVideo;
  submit: SubmitControl;
  onOpen: () => void;
}) {
  const notes = video.notes.length;
  const tags = video.tags.length;
  const translations = video.translations.length;
  const annotated = notes + tags + translations > 0;
  const submitError = submit.errors[video.video_id];

  return (
    <div className={styles.tileWrap}>
      <button type="button" className={styles.tile} onClick={onOpen} aria-label={`Open ${video.angle} video`}>
        <LazyThumb src={takeVideoUrl(video)} />
        <span className={styles.angleLabel}>{video.angle}</span>
        <span className={styles.tileDuration}>{formatDuration(video.duration_seconds)}</span>
        <span className={styles.playOverlay} aria-hidden="true">
          ▶
        </span>
      </button>

      <div className={styles.tileInfo}>
        {annotated ? (
          <div className={styles.tileStatus}>
            <span title="Notes">{notes} note{notes === 1 ? "" : "s"}</span>
            <span title="Tags">{tags} tag{tags === 1 ? "" : "s"}</span>
            <span title="Translations">{translations} transl.</span>
          </div>
        ) : (
          <div className={`${styles.tileStatus} ${styles.tileStatusEmpty}`}>Not annotated</div>
        )}

        {/* Far right of the row: download, then the annotation request status / submit button. */}
        <div className={styles.tileActions}>
          <DownloadButton take={take} video={video} compact />
          <SubmitAction video={video} submit={submit} compact />
          {submitError && <p className={styles.submitError}>{submitError}</p>}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Modal: review workspace
// --------------------------------------------------------------------------

function DetailCard({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <dl className={styles.cardList}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.cardRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type ViewMode = "single" | "all";

function ReviewModal({
  entry,
  list,
  tagSuggestions,
  submit,
  onSelect,
  onVideoChange,
  onTranslationAdded,
  onClose,
}: {
  entry: Entry;
  list: Entry[];
  tagSuggestions: string[];
  submit: SubmitControl;
  onSelect: (videoId: string) => void;
  onVideoChange: (videoId: string, change: VideoChange) => void;
  onTranslationAdded: (videoId: string, translation: Translation) => void;
  onClose: () => void;
}) {
  const { group, take, video: activeVideo } = entry;
  const { transcription, job } = group;

  const [mode, setMode] = useState<ViewMode>("single");
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  const index = list.findIndex((e) => e.video.video_id === activeVideo.video_id);
  const prev = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;

  function applyPlayback(el: HTMLVideoElement) {
    el.playbackRate = rate;
    el.loop = loop;
  }

  // Re-apply speed / loop whenever they change or a different set of videos is on screen.
  useEffect(() => {
    playerRef.current?.querySelectorAll("video").forEach(applyPlayback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, loop, mode, take.take_id, activeVideo.video_id]);

  function playerVideos(): HTMLVideoElement[] {
    return Array.from(playerRef.current?.querySelectorAll("video") ?? []);
  }

  function togglePlay() {
    const vids = playerVideos();
    if (vids.length === 0) return;
    const anyPlaying = vids.some((v) => !v.paused && !v.ended);
    vids.forEach((v) => {
      if (anyPlaying) v.pause();
      else void v.play().catch(() => {});
    });
  }

  function restart() {
    playerVideos().forEach((v) => {
      v.currentTime = 0;
      void v.play().catch(() => {});
    });
  }

  // Keyboard shortcuts. The handler is registered once and reads the latest
  // values through a ref, so it never goes stale.
  const latest = useRef({ prev, next, onSelect, onClose, togglePlay });
  latest.current = { prev, next, onSelect, onClose, togglePlay };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const l = latest.current;

      if (e.key === "Escape") {
        l.onClose();
        return;
      }
      // Don't hijack typing, or the native controls of the video itself.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "VIDEO" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowRight" && l.next) {
        e.preventDefault();
        l.onSelect(l.next.video.video_id);
      } else if (e.key === "ArrowLeft" && l.prev) {
        e.preventDefault();
        l.onSelect(l.prev.video.video_id);
      } else if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        l.togglePlay();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const cameraText = activeVideo.camera
    ? [activeVideo.camera.make, activeVideo.camera.model].filter(Boolean).join(" ") || activeVideo.camera.label
    : "";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Take details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <div className={styles.sentence}>{transcription.text}</div>
            <div className={styles.badgesRow}>
              <span className={styles.takeTitle}>Take {take.take_number}</span>
              <span className={`${styles.badge} ${take.is_valid ? styles.badgeValid : styles.badgeInvalid}`}>
                {take.is_valid ? "Valid" : "Invalid"}
              </span>
              <SessionBadge take={take} />
              <span className={styles.takeMeta}>{take.signer.name}</span>
            </div>
          </div>
          <div className={styles.modalNav}>
            <button
              type="button"
              className={styles.navButton}
              disabled={!prev}
              onClick={() => prev && onSelect(prev.video.video_id)}
              aria-label="Previous video"
              title="Previous video (←)"
            >
              ←
            </button>
            <span className={styles.navCount}>{index >= 0 ? `${index + 1} / ${list.length}` : "—"}</span>
            <button
              type="button"
              className={styles.navButton}
              disabled={!next}
              onClick={() => next && onSelect(next.video.video_id)}
              aria-label="Next video"
              title="Next video (→)"
            >
              →
            </button>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.playerCol}>
            <div className={styles.playerToolbar}>
              <div className={styles.angleTabs}>
                {take.videos.map((v) => (
                  <button
                    key={v.video_id}
                    type="button"
                    className={`${styles.angleTab} ${v.video_id === activeVideo.video_id ? styles.angleTabActive : ""}`}
                    onClick={() => onSelect(v.video_id)}
                  >
                    {v.angle}
                    {annotationCount(v) > 0 && <span className={styles.angleDot} title="Has annotations" />}
                  </button>
                ))}
              </div>
              {take.videos.length > 1 && (
                <div className={styles.modeToggle}>
                  <button
                    type="button"
                    className={`${styles.modeButton} ${mode === "single" ? styles.modeButtonActive : ""}`}
                    onClick={() => setMode("single")}
                  >
                    One angle
                  </button>
                  <button
                    type="button"
                    className={`${styles.modeButton} ${mode === "all" ? styles.modeButtonActive : ""}`}
                    onClick={() => setMode("all")}
                  >
                    All angles
                  </button>
                </div>
              )}
            </div>

            <div ref={playerRef}>
              {mode === "single" || take.videos.length < 2 ? (
                <video
                  key={activeVideo.video_id}
                  className={styles.video}
                  src={takeVideoUrl(activeVideo)}
                  controls
                  // Hides the player's Download button, and the right-click "Save video as…".
                  controlsList="nodownload"
                  onContextMenu={(e) => e.preventDefault()}
                  onLoadedMetadata={(e) => applyPlayback(e.currentTarget)}
                  autoPlay
                  playsInline
                  preload="metadata"
                  crossOrigin="use-credentials"
                />
              ) : (
                <div className={styles.angleGrid}>
                  {take.videos.map((v) => (
                    <div
                      key={v.video_id}
                      className={`${styles.gridCell} ${v.video_id === activeVideo.video_id ? styles.gridCellActive : ""}`}
                    >
                      <video
                        className={styles.gridVideo}
                        src={takeVideoUrl(v)}
                        muted
                        controlsList="nodownload"
                        onContextMenu={(e) => e.preventDefault()}
                        onLoadedMetadata={(e) => applyPlayback(e.currentTarget)}
                        playsInline
                        preload="metadata"
                        crossOrigin="use-credentials"
                      />
                      <button type="button" className={styles.gridLabel} onClick={() => onSelect(v.video_id)}>
                        {v.angle}
                        {v.video_id === activeVideo.video_id ? " · annotating" : " · click to annotate"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.playbackBar}>
              <button type="button" className={styles.playButton} onClick={togglePlay} title="Play / pause (Space)">
                ⏯ {mode === "all" ? "Play / pause all" : "Play / pause"}
              </button>
              <button type="button" className={styles.rateButton} onClick={restart}>
                ↺ Restart
              </button>
              <span className={styles.barDivider} />
              <span className={styles.barLabel}>Speed</span>
              {PLAYBACK_RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`${styles.rateButton} ${rate === r ? styles.rateButtonActive : ""}`}
                  onClick={() => setRate(r)}
                >
                  {r}×
                </button>
              ))}
              <span className={styles.barDivider} />
              <button
                type="button"
                className={`${styles.rateButton} ${loop ? styles.rateButtonActive : ""}`}
                aria-pressed={loop}
                onClick={() => setLoop((l) => !l)}
              >
                ⟳ Loop
              </button>
              <DownloadButton key={activeVideo.video_id} take={take} video={activeVideo} inBar />
            </div>

            <p className={styles.videoMeta}>
              {formatDuration(activeVideo.duration_seconds)}
              {activeVideo.resolution ? ` · ${activeVideo.resolution}` : ""}
              {activeVideo.fps ? ` · ${activeVideo.fps} fps` : ""}
              {cameraText ? ` · ${cameraText}` : ""}
            </p>

            <div className={styles.cards}>
              <DetailCard
                title="Take"
                rows={[
                  ["Status", take.is_valid ? "Valid" : "Invalid"],
                  [
                    "Reviewed by",
                    <>
                      {take.review.reviewed_by_signer_name ?? "—"}
                      {take.review.reviewed_at ? ` · ${formatDateTime(take.review.reviewed_at)}` : ""}
                    </>,
                  ],
                  ["Recorded", formatDateTime(take.created_at)],
                ]}
              />
              <DetailCard
                title="Signer"
                rows={[
                  ["Name", take.signer.name],
                  [
                    "Details",
                    `${take.signer.age} · ${take.signer.gender === "MALE" ? "Male" : "Female"}${take.signer.is_deaf ? " · Deaf" : ""}`,
                  ],
                ]}
              />
              <DetailCard
                title="Session"
                rows={[
                  ["Session", <SessionBadge key="s" take={take} />],
                  ["Date & time", formatDateTime(take.session.session_datetime)],
                  ["Recorder", take.session.recorder_name],
                  ["Assigned by", take.session.created_by_name],
                  ["State", take.session.ended_at ? `Ended ${formatDateTime(take.session.ended_at)}` : "Open"],
                ]}
              />
              <DetailCard
                title="Job"
                rows={[
                  [
                    "Job",
                    <span key="j" className={styles.mono}>
                      {displayJobId(job.job_id)}
                    </span>,
                  ],
                  ["File", job.filename],
                  ["Requestor", job.requestor_name],
                  [
                    "Sentence",
                    `#${transcription.row_number ?? "—"} · needs ${transcription.required_signer_count} signer${transcription.required_signer_count === 1 ? "" : "s"}`,
                  ],
                ]}
              />
            </div>
          </div>

          <div className={styles.sideCol}>
            {/* key: switching video starts a fresh panel for that video */}
            <AnnotationPanel
              key={activeVideo.video_id}
              video={activeVideo}
              tagSuggestions={tagSuggestions}
              submit={submit}
              onNoteAdded={(note) => onVideoChange(activeVideo.video_id, (v) => ({ notes: [note, ...v.notes] }))}
              onTagsChanged={(tags) => onVideoChange(activeVideo.video_id, () => ({ tags }))}
              onTranslationAdded={(translation) => onTranslationAdded(activeVideo.video_id, translation)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Notes / tags / translations panel (one per video)
// --------------------------------------------------------------------------

type PanelTab = "notes" | "tags" | "translations";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the AnnotateVideo permission to do this.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

function AnnotationPanel({
  video,
  tagSuggestions,
  submit,
  onNoteAdded,
  onTagsChanged,
  onTranslationAdded,
}: {
  video: TakeVideo;
  tagSuggestions: string[];
  submit: SubmitControl;
  onNoteAdded: (note: VideoNote) => void;
  onTagsChanged: (tags: VideoTag[]) => void;
  onTranslationAdded: (translation: Translation) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("notes");
  const submitError = submit.errors[video.video_id];

  const tabs: { id: PanelTab; label: string; count: number }[] = [
    { id: "notes", label: "Notes", count: video.notes.length },
    { id: "tags", label: "Tags", count: video.tags.length },
    { id: "translations", label: "Translations", count: video.translations.length },
  ];

  // All three tabs stay mounted (just hidden) so a half-typed note isn't lost
  // when you flip to another tab.
  return (
    <aside className={styles.panel} aria-label={`Notes, tags and translations for the ${video.angle} video`}>
      <div className={styles.panelHeading}>
        <span>
          {video.angle} video <span className={styles.panelHeadingSub}>· notes, tags &amp; translations</span>
        </span>
        <div className={styles.panelHeadingActions}>
          <SubmitAction video={video} submit={submit} compact />
        </div>
      </div>
      {submitError && <p className={`${styles.submitError} ${styles.submitErrorPanel}`}>{submitError}</p>}

      {/* Always-visible summary, so you can see what's already on the video whichever tab is open. */}
      {(video.tags.length > 0 || video.translations.length > 0) && (
        <div className={styles.summary}>
          {video.tags.length > 0 && (
            <ul className={styles.chips}>
              {video.tags.map((t) => (
                <li key={t.tag_id} className={styles.chip} style={{ "--hue": tagHue(t.name) } as CSSProperties}>
                  {t.name}
                </li>
              ))}
            </ul>
          )}
          {video.translations.length > 0 && (
            <ul className={styles.summaryTranslations}>
              {video.translations.map((t) => (
                <li key={t.translation_id}>
                  <span className={styles.summaryKey}>{t.key}</span> {t.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.panelTabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.panelTab} ${tab === t.id ? styles.panelTabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className={styles.panelTabCount}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div className={styles.panelBody}>
        <div hidden={tab !== "notes"}>
          <NotesTab videoId={video.video_id} notes={video.notes} onNoteAdded={onNoteAdded} />
        </div>
        <div hidden={tab !== "tags"}>
          <TagsTab
            videoId={video.video_id}
            tags={video.tags}
            suggestions={tagSuggestions}
            onTagsChanged={onTagsChanged}
          />
        </div>
        <div hidden={tab !== "translations"}>
          <TranslationsTab
            videoId={video.video_id}
            translations={video.translations}
            onTranslationAdded={onTranslationAdded}
          />
        </div>
      </div>
    </aside>
  );
}

function NotesTab({
  videoId,
  notes,
  onNoteAdded,
}: {
  videoId: string;
  notes: VideoNote[];
  onNoteAdded: (note: VideoNote) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const note = await addVideoNote(videoId, value);
      onNoteAdded(note);
      setText("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't add the note."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.form}>
        <textarea
          className={styles.textarea}
          rows={3}
          placeholder="Write a note about this video…  (Ctrl/⌘ + Enter to add)"
          value={text}
          maxLength={5000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className={styles.formRow}>
          <button type="button" className={styles.addButton} disabled={busy || !text.trim()} onClick={submit}>
            {busy ? "Adding…" : "Add note"}
          </button>
        </div>
        {error && <p className={styles.formError}>{error}</p>}
      </div>

      {notes.length === 0 ? (
        <p className={styles.emptyText}>No notes on this video yet.</p>
      ) : (
        <ul className={styles.list}>
          {notes.map((n) => (
            <li key={n.note_id} className={styles.listItem}>
              <p className={styles.noteText}>{n.text}</p>
              <p className={styles.itemMeta}>
                {n.created_by_name} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TagsTab({
  videoId,
  tags,
  suggestions,
  onTagsChanged,
}: {
  videoId: string;
  tags: VideoTag[];
  suggestions: string[];
  onTagsChanged: (tags: VideoTag[]) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNames(names: string[]) {
    if (names.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The API returns every tag on the video after the change.
      const updated = await addVideoTags(videoId, names);
      onTagsChanged(updated);
      setText("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't add the tags."));
    } finally {
      setBusy(false);
    }
  }

  function submitText() {
    void addNames(
      text
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    );
  }

  // Tags used elsewhere on this page that this video doesn't have yet.
  const have = new Set(tags.map((t) => t.name.toLowerCase()));
  const typed = text.trim().toLowerCase();
  const available = suggestions
    .filter((s) => !have.has(s.toLowerCase()))
    .filter((s) => !typed || s.toLowerCase().includes(typed))
    .slice(0, 12);

  return (
    <div className={styles.tabContent}>
      <div className={styles.form}>
        <div className={styles.formRow}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder="Add tags, separated by commas"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitText();
              }
            }}
          />
          <button type="button" className={styles.addButton} disabled={busy || !text.trim()} onClick={submitText}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>

        {available.length > 0 && (
          <div className={styles.keyHints}>
            <span className={styles.keyHintLabel}>Used on this page — click to add:</span>
            {available.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.keyHint}
                disabled={busy}
                onClick={() => void addNames([s])}
              >
                + {s}
              </button>
            ))}
          </div>
        )}
        {error && <p className={styles.formError}>{error}</p>}
      </div>

      {tags.length === 0 ? (
        <p className={styles.emptyText}>No tags on this video yet.</p>
      ) : (
        <ul className={styles.chips}>
          {tags.map((t) => (
            <li key={t.tag_id} className={styles.chip} style={{ "--hue": tagHue(t.name) } as CSSProperties}>
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TranslationsTab({
  videoId,
  translations,
  onTranslationAdded,
}: {
  videoId: string;
  translations: Translation[];
  onTranslationAdded: (translation: Translation) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<TranslationKey[]>([]);

  // Ask the API for existing keys that match or look like what's being typed
  // ("telgu" -> "Telugu"). With an empty box it returns the most used keys.
  // Needs the AnnotateVideo permission; without it there are simply no hints.
  useEffect(() => {
    let cancelled = false;
    const term = key.trim();
    const handle = setTimeout(
      () => {
        getTranslationKeys({ q: term || undefined, limit: 12 })
          .then((rows) => {
            if (!cancelled) setExisting(rows);
          })
          .catch(() => {
            if (!cancelled) setExisting([]);
          });
      },
      term ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [key]);

  // A video holds one value per key. Keys this video already has are still
  // shown (so you can see the match), but greyed out and not clickable, and
  // listed after the ones you can use.
  const usedHere = new Set(translations.map((t) => t.key.toLowerCase()));
  const hints = existing
    .map((h) => ({ ...h, used: usedHere.has(h.key.toLowerCase()) }))
    .sort((a, b) => Number(a.used) - Number(b.used))
    .slice(0, 6);

  async function submit() {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addVideoTranslation(videoId, k, v);
      onTranslationAdded(created);
      setKey("");
      setValue("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't add the translation."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.form}>
        <input
          type="text"
          className={styles.fieldInput}
          placeholder="Language or label, e.g. Telugu"
          value={key}
          maxLength={100}
          onChange={(e) => setKey(e.target.value)}
        />

        {hints.length > 0 && (
          <div className={styles.keyHints}>
            <span className={styles.keyHintLabel}>{key.trim() ? "Similar existing keys:" : "Existing keys:"}</span>
            {hints.map((h) => (
              <button
                key={h.key}
                type="button"
                className={`${styles.keyHint} ${h.used ? styles.keyHintUsed : ""}`}
                disabled={h.used}
                title={
                  h.used
                    ? `This video already has a ${h.key} translation`
                    : `Used on ${h.usage_count} video${h.usage_count === 1 ? "" : "s"}`
                }
                onClick={() => setKey(h.key)}
              >
                {h.key}
                {h.used ? " · added" : ""}
              </button>
            ))}
          </div>
        )}

        <textarea
          className={styles.textarea}
          rows={3}
          placeholder="Translation…  (Ctrl/⌘ + Enter to add)"
          value={value}
          maxLength={2048}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className={styles.formRow}>
          <button
            type="button"
            className={styles.addButton}
            disabled={busy || !key.trim() || !value.trim()}
            onClick={submit}
          >
            {busy ? "Adding…" : "Add translation"}
          </button>
        </div>
        {error && <p className={styles.formError}>{error}</p>}
      </div>

      {translations.length === 0 ? (
        <p className={styles.emptyText}>No translations on this video yet.</p>
      ) : (
        <ul className={styles.list}>
          {translations.map((t) => (
            <li key={t.translation_id} className={styles.listItem}>
              <p className={styles.translationKey}>{t.key}</p>
              <p className={styles.noteText}>{t.value}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}