"use client";

// Location: src/components/annotations/AnnotationReviewModal.tsx
//
// The review workspace from the Videos page (player with speed / loop controls,
// all angles side by side, take / signer / session / job details, and notes /
// tags / translations on the right), reusable from the annotation pages:
//
//   <AnnotationReviewModal target={row} readOnly onClose={...} />
//
// A row of an annotation list only knows its sentence and video, so the modal
// loads the full sentence (all of its takes and videos, with their notes, tags
// and translations) itself: GET /videos/search?transcription_id=...
// That endpoint needs the "ReadDataset" permission. Adding notes, tags and
// translations needs "AnnotateVideo" (the API answers 403 otherwise).
//
//   readOnly  - notes, tags and translations are shown but cannot be added
//               (used on the Submitted page).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./AnnotationReviewModal.module.css";
import {
  searchTakeVideos,
  takeVideoUrl,
  addVideoNote,
  addVideoTags,
  addVideoTranslation,
  getTranslationKeys,
  ApiError,
  type TranscriptionGroup,
  type VideoTake,
  type TakeVideo,
  type VideoNote,
  type VideoTag,
  type Translation,
  type TranslationKey,
} from "@/lib/api";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.5];

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
 * colour on every video. FNV-1a spreads similar names far apart on the colour wheel.
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the AnnotateVideo permission to do this.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return "You need the ReadDataset permission to open the video review.";
  }
  return err instanceof Error && err.message ? err.message : "Couldn't load this video.";
}

// --------------------------------------------------------------------------
// Public component: loads the sentence, then shows the review workspace
// --------------------------------------------------------------------------

/** What a row of any annotation list provides: enough to find the video again. */
export type ReviewTarget = { transcription_id: string; video_id: string };

export default function AnnotationReviewModal({
  target,
  readOnly = false,
  extraBadges,
  onClose,
}: {
  target: ReviewTarget;
  /** Show notes, tags and translations without the option to add any. */
  readOnly?: boolean;
  /** Shown next to the take badges in the header, e.g. the annotation task's status. */
  extraBadges?: ReactNode;
  onClose: () => void;
}) {
  const [group, setGroup] = useState<TranscriptionGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(target.video_id);

  useEffect(() => {
    let cancelled = false;
    setGroup(null);
    setError(null);
    setActiveId(target.video_id);

    searchTakeVideos({ transcriptionId: target.transcription_id, limit: 1 })
      .then((res) => {
        if (cancelled) return;
        const g = res.items[0];
        if (g) setGroup(g);
        else setError("Couldn't find the details for this video.");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(loadErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [target.transcription_id, target.video_id]);

  const entries = useMemo(() => (group ? flatten([group]) : []), [group]);
  const entry = entries.find((e) => e.video.video_id === activeId);

  // Tags already used on this sentence's videos, most common first: one-click suggestions.
  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const e of entries) {
      for (const t of e.video.tags) {
        const k = t.name.toLowerCase();
        const cur = counts.get(k);
        if (cur) cur.n += 1;
        else counts.set(k, { name: t.name, n: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.name);
  }, [entries]);

  // While loading (or after an error) the workspace isn't mounted, so Esc is handled here.
  useEffect(() => {
    if (entry) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [entry, onClose]);

  // ---- Local updates after a successful add, so the UI changes without a refetch ----

  function updateVideo(videoId: string, change: VideoChange) {
    setGroup(
      (prev) =>
        prev && {
          ...prev,
          takes: prev.takes.map((t) => ({
            ...t,
            videos: t.videos.map((v) => (v.video_id === videoId ? { ...v, ...change(v) } : v)),
          })),
        },
    );
  }

  function handleTranslationAdded(videoId: string, translation: Translation) {
    updateVideo(videoId, (v) => ({
      translations: [...v.translations, translation].sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }

  if (!entry) {
    const message = error ?? (group ? "Couldn't find the details for this video." : null);
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div
          className={`${styles.modal} ${styles.modalShell}`}
          role="dialog"
          aria-modal="true"
          aria-label="Video details"
          onClick={(e) => e.stopPropagation()}
        >
          <header className={styles.modalHeader}>
            <div className={styles.modalHeaderMain}>
              <div className={styles.sentence}>Video details</div>
            </div>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </header>
          <div className={styles.shellBody}>
            {message ? <p className={styles.errorText}>{message}</p> : <p className={styles.stateText}>Loading video…</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReviewModal
      entry={entry}
      list={entries}
      tagSuggestions={tagSuggestions}
      readOnly={readOnly}
      extraBadges={extraBadges}
      onSelect={setActiveId}
      onVideoChange={updateVideo}
      onTranslationAdded={handleTranslationAdded}
      onClose={onClose}
    />
  );
}

// --------------------------------------------------------------------------
// Review workspace
// --------------------------------------------------------------------------

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
  readOnly,
  extraBadges,
  onSelect,
  onVideoChange,
  onTranslationAdded,
  onClose,
}: {
  entry: Entry;
  list: Entry[];
  tagSuggestions: string[];
  readOnly: boolean;
  extraBadges?: ReactNode;
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
              {extraBadges}
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
                        {v.video_id === activeVideo.video_id ? " · selected" : " · click to select"}
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
              readOnly={readOnly}
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

function AnnotationPanel({
  video,
  tagSuggestions,
  readOnly,
  onNoteAdded,
  onTagsChanged,
  onTranslationAdded,
}: {
  video: TakeVideo;
  tagSuggestions: string[];
  readOnly: boolean;
  onNoteAdded: (note: VideoNote) => void;
  onTagsChanged: (tags: VideoTag[]) => void;
  onTranslationAdded: (translation: Translation) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("notes");

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
        {readOnly && <span className={styles.viewOnly}>View only</span>}
      </div>

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
          <NotesTab videoId={video.video_id} notes={video.notes} readOnly={readOnly} onNoteAdded={onNoteAdded} />
        </div>
        <div hidden={tab !== "tags"}>
          <TagsTab
            videoId={video.video_id}
            tags={video.tags}
            suggestions={tagSuggestions}
            readOnly={readOnly}
            onTagsChanged={onTagsChanged}
          />
        </div>
        <div hidden={tab !== "translations"}>
          <TranslationsTab
            videoId={video.video_id}
            translations={video.translations}
            readOnly={readOnly}
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
  readOnly,
  onNoteAdded,
}: {
  videoId: string;
  notes: VideoNote[];
  readOnly: boolean;
  onNoteAdded: (note: VideoNote) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = text.trim();
    if (!value || busy || readOnly) return;
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
      {!readOnly && (
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
      )}

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
  readOnly,
  onTagsChanged,
}: {
  videoId: string;
  tags: VideoTag[];
  suggestions: string[];
  readOnly: boolean;
  onTagsChanged: (tags: VideoTag[]) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNames(names: string[]) {
    if (names.length === 0 || busy || readOnly) return;
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

  // Tags used elsewhere on this sentence that this video doesn't have yet.
  const have = new Set(tags.map((t) => t.name.toLowerCase()));
  const typed = text.trim().toLowerCase();
  const available = suggestions
    .filter((s) => !have.has(s.toLowerCase()))
    .filter((s) => !typed || s.toLowerCase().includes(typed))
    .slice(0, 12);

  return (
    <div className={styles.tabContent}>
      {!readOnly && (
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
              <span className={styles.keyHintLabel}>Used on this sentence — click to add:</span>
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
      )}

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
  readOnly,
  onTranslationAdded,
}: {
  videoId: string;
  translations: Translation[];
  readOnly: boolean;
  onTranslationAdded: (translation: Translation) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<TranslationKey[]>([]);

  // Ask the API for existing keys that match or look like what's being typed
  // ("telgu" -> "Telugu"). With an empty box it returns the most used keys.
  // Skipped in read-only mode, where nothing can be added.
  useEffect(() => {
    if (readOnly) return;
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
  }, [key, readOnly]);

  // A video holds one value per key. Keys this video already has are still
  // shown (so you can see the match), but greyed out and not clickable.
  const usedHere = new Set(translations.map((t) => t.key.toLowerCase()));
  const hints = existing
    .map((h) => ({ ...h, used: usedHere.has(h.key.toLowerCase()) }))
    .sort((a, b) => Number(a.used) - Number(b.used))
    .slice(0, 6);

  async function submit() {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v || busy || readOnly) return;
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
      {!readOnly && (
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
      )}

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