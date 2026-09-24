"use client";

// Location: src/app/dashboard/jobs/[job_id]/sessions/[session_id]/RecorderPanel.tsx
//
// Ported from the recorder project's record/page.tsx (RecordPageInner +
// RecordingsModal + SyncedClipGrid), adapted to live inside this
// project's session page instead of being its own route. Key changes
// from the original:
//
//   - No searchParams/takeId from the URL. The "take id" the agent
//     records under, and that recordings/uploads are grouped by, is the
//     currently SELECTED TRANSCRIPTION's id -- a session can walk through
//     several transcriptions, each recorded separately. See `takeId`
//     below.
//   - The teleprompter's BroadcastChannel is keyed by session id (stable
//     for the page's lifetime), NOT by takeId -- so the popup, once
//     opened, stays connected across transcription switches instead of
//     needing to be reopened. Which transcription's text it's showing is
//     just a "script" message pushed on that same channel.
//   - No script fetch: `transcription.text` is already the full script
//     (loaded by the session page via listSignerPendingTranscriptions),
//     so the loading/error states the original had around fetching
//     `${BASE_URL}/media/transcription/{id}` are gone entirely.
//   - Upload now hits the real backend endpoint:
//     POST /jobs/{job_id}/sessions/{session_id}/transcriptions/{transcription_id}/videos
//     (see `uploadTakeVideos` below). It's a real XHR so the progress bar
//     reflects actual bytes sent and Cancel actually aborts the request.
//   - The "Upload" action is no longer scoped to whichever recording tab
//     happens to be selected in the modal. Clicking it queues and
//     uploads EVERY recorded attempt for the current transcription (each
//     becomes its own Take on the backend, carrying that attempt's own
//     Valid/Invalid marking), regardless of which tab is active when you
//     click it.
//   - attemptAngles (which angle each camera recorded as, per attempt)
//     is now keyed by takeId first, then attempt index, since different
//     transcriptions' attempts must never mix.
//   - Every recording defaults to INVALID. The operator has to manually
//     mark a recording as Valid before uploading it. See
//     `DEFAULT_ATTEMPT_VALIDITY` below.
//   - MANUAL VIDEO IMPORT: every angle slot has an "Add video" button.
//     Picking a file creates an "imported take" that flows through the
//     exact same pipeline as an agent (GoPro) take: it appears in the
//     Recordings modal (synced playback, Valid/Invalid, Discard, Forget)
//     and is uploaded through the same `uploadTakeVideos` call, with the
//     slot's angle as `angle`. Imported takes use attempt indexes starting
//     at MANUAL_ATTEMPT_BASE so they never collide with the agent's
//     0, 1, 2... attempts, and are labelled "Import N" in the UI.
//   - The "View Recordings (N)" button count now EXCLUDES discarded
//     attempts and attempts whose clips were all forgotten
//     (`activeAttemptCount`), and further breaks that down against how
//     many of those are still awaiting upload (`pendingUploadCount`) --
//     see the FIX notes below.
//
// ---------------------------------------------------------------------
// FIX (this revision): "already uploaded" bleeding across transcriptions
// ---------------------------------------------------------------------
// The agent numbers attempts (0, 1, 2, ...) starting from zero for EACH
// takeId (see attemptAnglesByTake etc. below, all keyed by takeId).  The
// Recordings modal, however, previously tracked which attempt indexes
// had been uploaded in a single `useState<Set<number>>` local to
// RecordingsModal -- NOT scoped by transcription. Because RecordingsModal
// itself is never unmounted when you switch transcriptions (only its
// props change), that set kept accumulating indexes across every
// transcription you visited. So after uploading transcription A's first
// take (attempt index 0), switching to transcription B and recording a
// brand new take (which also gets attempt index 0, since indexing
// restarts per takeId) would immediately show as "already uploaded",
// and the "View Recordings" badge on the panel never reflected the new
// take because the stale, cross-transcription set was being consulted.
//
// The fix: uploaded-attempt bookkeeping now lives in RecorderPanel,
// keyed by takeId (`uploadedAttemptsByTake`), the same pattern already
// used for attemptValidityByTake / discardedByTake / forgottenClipsByTake.
// RecordingsModal receives the current transcription's slice as a plain
// prop (`uploadedAttempts`) instead of owning its own state, so switching
// transcriptions can never leak one take's upload status onto another's.
// The modal's other transient, in-progress-upload state (phase, queue,
// progress, error) is reset whenever the transcription id it's showing
// changes, so a stale "success"/"uploading" screen from a previous
// transcription can't reappear for a new one either.
//
// A second, related fix: uploading used to leave the *session page's*
// pending/worked lists (and therefore the "Done in this session" count)
// stale until the operator manually switched transcriptions, because
// nothing told the parent page to refetch after an upload finished. A
// new `onUploadComplete` callback fires once a full upload run succeeds,
// so the session page can refresh those lists immediately.
//
// ---------------------------------------------------------------------
// UPDATE: "show on teleprompter" for a recorded/imported clip
// ---------------------------------------------------------------------
// Each camera tile inside the Recordings modal now has a button that
// pushes that clip onto the teleprompter window (via the same
// BroadcastChannel already used for script/phase/control messages) in
// place of the scrolling script, so the presenter (or anyone watching
// the teleprompter display) can review the take itself rather than the
// text. Clicking it again -- or the modal being closed, or the
// transcription being switched -- clears it and hands the teleprompter
// back to the script. See `handleToggleTeleprompter` and the
// `postToPrompter` prop threaded into RecordingsModal below, and the
// `videoPreview` message type in useTeleprompterChannel.ts.
// ---------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./RecorderPanel.module.css";
import CountdownOverlay from "@/components/CountdownOverlay";
import MjpegStream from "@/components/MjpegStream";
import {
  AGENT_HTTP_URL,
  useAgentConnection,
  type CameraMetadata,
  type DetectedCamera,
} from "@/hooks/useAgentConnection";
import {
  useTeleprompterChannel,
  type PrompterMessage,
  type RecordingPhase,
} from "@/hooks/useTeleprompterChannel";
import {
  KNOWN_ANGLES,
  loadAssignments,
  saveAssignments,
  angleForCamera,
  type ViewAngle,
  type AngleAssignments,
} from "@/lib/cameraAssignments";
import { uploadTakeVideos, ApiError, type UploadTakeVideoFile, type TranscriptionRow } from "@/lib/api";

const NO_SELECTION_SCRIPT =
  "Select a transcription on the left to load its script here.";

const DEFAULT_FONT_SIZE = 42; // px, matches teleprompter popup's default
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 72;
const FONT_STEP = 4;

const DEFAULT_SPEED = 28; // px/sec, matches teleprompter popup's default
const MIN_SPEED = 8;
const MAX_SPEED = 80;

// Any recording the operator hasn't explicitly marked is treated as
// INVALID. The operator reviews each take and manually flips the good
// ones to Valid before uploading.
const DEFAULT_ATTEMPT_VALIDITY = false;

const ANGLE_HISTORY_STORAGE_KEY = "session-recorder:camera-angle-history";

// ---- Manually imported videos ----
const MANUAL_CAMERA_PREFIX = "manual:";
const MANUAL_ATTEMPT_BASE = 10000;

function attemptLabel(idx: number): string {
  return idx >= MANUAL_ATTEMPT_BASE
    ? `Import ${idx - MANUAL_ATTEMPT_BASE + 1}`
    : `Recording ${idx + 1}`;
}

type ManualClip = { filename: string; url: string };
// takeId -> attemptIndex -> angle -> clip
type ManualByTake = Record<string, Record<number, Record<string, ManualClip>>>;

const importBtnStyle: React.CSSProperties = {
  marginTop: 6,
  width: "100%",
  padding: "0.4rem 0.6rem",
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 8,
  border: "1px dashed rgba(128,128,128,0.6)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

function loadAngleHistory(): Record<string, ViewAngle> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ANGLE_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ViewAngle>) : {};
  } catch {
    return {};
  }
}

function saveAngleHistory(history: Record<string, ViewAngle>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANGLE_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Best-effort, same as assignments persistence.
  }
}

// ---------------------------------------------------------------------
// Recordings modal (unchanged in spirit from the original) -- grid view
// of every downloaded clip, synced multi-cam playback, per-attempt tabs.
// ---------------------------------------------------------------------

type RecordingClip = {
  key: string;
  cameraId: string;
  cameraName: string;
  index: number;
  filename: string;
  url?: string;
  error?: string;
};

type TakePreviews = Record<string, Array<{ index: number; filename: string; url?: string; error?: string }>>;

async function fetchClipBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't read clip off the camera (${res.status})`);
  }
  return res.blob();
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "2rem",
  },
  modal: {
    background: "#111",
    color: "#fff",
    borderRadius: 12,
    width: "min(1200px, 100%)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    flexShrink: 0,
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: 18,
    cursor: "pointer",
    lineHeight: 1,
    padding: "0.25rem 0.5rem",
  },
  body: {
    padding: "1.25rem",
    overflowY: "auto",
  },
  indexTabs: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  indexTab: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 999,
    padding: "0.35rem 0.9rem",
    cursor: "pointer",
    color: "#fff",
    fontSize: 13,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    lineHeight: 1.3,
  },
  indexTabActive: {
    background: "#fff",
    color: "#111",
    fontWeight: 600,
  },
  indexTabDiscarded: {
    opacity: 0.45,
    textDecoration: "line-through",
  },
  indexTabSubtext: {
    fontSize: 11,
    opacity: 0.65,
  },
  masterControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginTop: "1rem",
    padding: "0.6rem 0.8rem",
    background: "rgba(255,255,255,0.05)",
    borderRadius: 10,
  },
  masterPlayBtn: {
    background: "#fff",
    color: "#111",
    border: "none",
    borderRadius: "50%",
    width: 36,
    height: 36,
    fontSize: 15,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  masterTime: {
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    color: "rgba(255,255,255,0.75)",
    flexShrink: 0,
    minWidth: 84,
  },
  masterSeek: {
    flex: 1,
  },
  multiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 200px))",
    justifyContent: "start",
    gap: "0.6rem",
  },
  multiTile: {
    background: "#000",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 6,
    overflow: "hidden",
  },
  multiVideo: {
    width: "100%",
    aspectRatio: "16 / 9",
    display: "block",
    background: "#000",
  },
  // Maximized tile: spans the full grid width and jumps to the top via
  // `order`. Because the DOM order never changes (only CSS does), the
  // <video> elements are NOT remounted, so playback position and the
  // multi-camera sync are preserved when toggling.
  multiTileMaximized: {
    gridColumn: "1 / -1",
    order: -1,
  },
  multiVideoMaximized: {
    maxHeight: "65vh",
    objectFit: "contain",
  },
  multiTileLabel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.4rem 0.6rem",
    fontSize: 13,
  },
  tileActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.2rem",
  },
  errorTile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.4rem",
    width: "100%",
    aspectRatio: "16 / 9",
    background: "rgba(255,255,255,0.03)",
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    textAlign: "center",
    padding: "0.5rem",
  },
  audioToggleBtn: {
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    padding: "0.1rem 0.3rem",
    lineHeight: 1,
  },
  teleprompterToggleBtnActive: {
    color: "#5ec2ff",
  },
  uploadBtn: {
    background: "#2f6fed",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0.55rem 1rem",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  uploadBtnDisabled: {
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.4)",
    cursor: "not-allowed",
  },
  uploadBtnDone: {
    background: "rgba(52, 199, 89, 0.18)",
    color: "#34c759",
  },
  confirmOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
    padding: "1.5rem",
  },
  confirmBox: {
    background: "#1a1a1a",
    color: "#fff",
    borderRadius: 12,
    width: "min(420px, 100%)",
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.9rem",
  },
  confirmNote: {
    margin: 0,
    fontSize: 12,
    color: "#d9a441",
    background: "rgba(217, 164, 65, 0.12)",
    border: "1px solid rgba(217, 164, 65, 0.3)",
    borderRadius: 8,
    padding: "0.5rem 0.7rem",
  },
  confirmList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  confirmListItem: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 6,
    padding: "0.45rem 0.6rem",
  },
  confirmActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    marginTop: "0.25rem",
  },
  confirmCancelBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.25)",
    color: "#fff",
    borderRadius: 8,
    padding: "0.5rem 1rem",
    fontSize: 13,
    cursor: "pointer",
  },
  progressStatusRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    marginBottom: "0.4rem",
  },
  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    background: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "#2f6fed",
    borderRadius: 999,
    transition: "width 120ms linear",
  },
  successText: {
    color: "#34c759",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: 13,
  },
  validityRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginBottom: "0.75rem",
    flexWrap: "wrap",
  },
  validityLabel: {
    fontSize: 12.5,
    color: "rgba(255,255,255,0.65)",
  },
  validityToggle: {
    display: "inline-flex",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  validityBtn: {
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.65)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "0.35rem 0.85rem",
    cursor: "pointer",
  },
  validityBtnValidActive: {
    background: "rgba(52, 199, 89, 0.22)",
    color: "#34c759",
  },
  validityBtnInvalidActive: {
    background: "rgba(255, 107, 107, 0.2)",
    color: "#ff6b6b",
  },
  tabValidityDotValid: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#34c759",
    marginLeft: 6,
  },
  tabValidityDotInvalid: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#ff6b6b",
    marginLeft: 6,
  },
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SYNC_DRIFT_TOLERANCE_S = 0.25;

function resolveKnownDuration(el: HTMLVideoElement | undefined | null): number {
  if (!el) return 0;
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  if (el.seekable.length > 0) return el.seekable.end(el.seekable.length - 1);
  return 0;
}

function SyncedClipGrid({
  clips,
  onForgetClip,
  disableForget,
  onToggleTeleprompter,
  teleprompterActiveKey,
}: {
  clips: RecordingClip[];
  // Optional so SyncedClipGrid still works standalone. When provided,
  // each tile gets a "forget" action that fully drops that one camera's
  // clip for this attempt -- e.g. a stale clip from a camera that's
  // since been disconnected.
  onForgetClip?: (cameraId: string, attemptIndex: number) => void;
  // True while this grid is showing the attempt that's actively
  // mid-transfer -- forgetting a clip can't retroactively pull it out
  // of a request that's already sending, so the button is disabled
  // (not hidden, so it's still clear it exists) rather than silently
  // doing nothing.
  disableForget?: boolean;
  // Optional so SyncedClipGrid still works standalone. When provided,
  // each playable tile gets a "show on teleprompter" toggle that pushes
  // (or pulls back) this clip on the teleprompter window in place of
  // the script.
  onToggleTeleprompter?: (clip: RecordingClip) => void;
  // The clip.key currently being shown on the teleprompter, if any --
  // used to render that one tile's toggle button as "active"/"cancel".
  teleprompterActiveKey?: string | null;
}) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const leaderKeyRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const playableClips = useMemo(() => clips.filter((c) => !!c.url), [clips]);
  const [audibleKey, setAudibleKey] = useState<string | null>(playableClips[0]?.key ?? null);
  // Which clip (if any) is currently maximized to fill the grid width.
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);

  const toggleMaximize = useCallback((key: string) => {
    setMaximizedKey((prev) => (prev === key ? null : key));
  }, []);

  useEffect(() => {
    videoRefs.current.clear();
    leaderKeyRef.current = null;
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setAudibleKey(playableClips[0]?.key ?? null);
    setMaximizedKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  const registerRef = useCallback(
    (key: string) => (el: HTMLVideoElement | null) => {
      if (el) videoRefs.current.set(key, el);
      else videoRefs.current.delete(key);
    },
    []
  );

  const handleLoadedMetadata = useCallback((clip: RecordingClip) => {
    const el = videoRefs.current.get(clip.key);
    if (!el) return;
    const known = resolveKnownDuration(el);
    if (known > 0) {
      setDuration((prev) => Math.max(prev, known));
    }
    const currentLeaderDuration = leaderKeyRef.current
      ? resolveKnownDuration(videoRefs.current.get(leaderKeyRef.current))
      : -1;
    if (known > currentLeaderDuration) {
      leaderKeyRef.current = clip.key;
    }
  }, []);

  const handleTimeUpdate = useCallback((clip: RecordingClip) => {
    if (clip.key !== leaderKeyRef.current) return;
    const leaderEl = videoRefs.current.get(clip.key);
    if (!leaderEl) return;
    setCurrentTime(leaderEl.currentTime);
    const known = resolveKnownDuration(leaderEl);
    if (known > 0) {
      setDuration((prev) => Math.max(prev, known));
    }

    videoRefs.current.forEach((followerEl, key) => {
      if (key === clip.key) return;
      if (Math.abs(followerEl.currentTime - leaderEl.currentTime) > SYNC_DRIFT_TOLERANCE_S) {
        followerEl.currentTime = leaderEl.currentTime;
      }
    });
  }, []);

  const handleDurationChange = useCallback((clip: RecordingClip) => {
    if (clip.key !== leaderKeyRef.current) return;
    const known = resolveKnownDuration(videoRefs.current.get(clip.key));
    if (known > 0) setDuration((prev) => Math.max(prev, known));
  }, []);

  const handleEnded = useCallback((clip: RecordingClip) => {
    if (clip.key !== leaderKeyRef.current) return;
    setIsPlaying(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    const nextPlaying = !isPlaying;
    videoRefs.current.forEach((el) => {
      if (nextPlaying) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
    setIsPlaying(nextPlaying);
  }, [isPlaying]);

  const handleSeek = useCallback((time: number) => {
    videoRefs.current.forEach((el) => {
      el.currentTime = Math.min(time, el.duration || time);
    });
    setCurrentTime(time);
  }, []);

  return (
    <div>
      <div style={modalStyles.multiGrid}>
        {clips.map((clip) => {
          const isMaximized = clip.key === maximizedKey;
          const isOnTeleprompter = clip.key === teleprompterActiveKey;
          return (
          <div
            key={clip.key}
            style={{
              ...modalStyles.multiTile,
              ...(isMaximized ? modalStyles.multiTileMaximized : {}),
            }}
          >
            {clip.url ? (
              <video
                ref={registerRef(clip.key)}
                src={clip.url}
                muted={clip.key !== audibleKey}
                playsInline
                onLoadedMetadata={() => handleLoadedMetadata(clip)}
                onDurationChange={() => handleDurationChange(clip)}
                onTimeUpdate={() => handleTimeUpdate(clip)}
                onEnded={() => handleEnded(clip)}
                onDoubleClick={() => toggleMaximize(clip.key)}
                style={{
                  ...modalStyles.multiVideo,
                  ...(isMaximized ? modalStyles.multiVideoMaximized : {}),
                }}
              />
            ) : (
              <div style={modalStyles.errorTile}>
                <span>⚠</span>
                <span>{clip.error ?? "No clip available"}</span>
              </div>
            )}
            <div style={modalStyles.multiTileLabel}>
              <span>{clip.cameraName}</span>
              <span style={modalStyles.tileActions}>
                {clip.url && (
                  <>
                    <button
                      type="button"
                      style={modalStyles.audioToggleBtn}
                      onClick={() => toggleMaximize(clip.key)}
                      title={isMaximized ? "Restore size" : "Maximize this video"}
                      aria-label={isMaximized ? "Restore video size" : "Maximize video"}
                    >
                      {isMaximized ? "⤡" : "⤢"}
                    </button>
                    <button
                      type="button"
                      style={modalStyles.audioToggleBtn}
                      onClick={() => setAudibleKey(clip.key)}
                      title={
                        clip.key === audibleKey
                          ? "Audio is from this camera"
                          : "Switch audio to this camera"
                      }
                    >
                      {clip.key === audibleKey ? "🔊" : "🔇"}
                    </button>
                    {onToggleTeleprompter && (
                      <button
                        type="button"
                        style={{
                          ...modalStyles.audioToggleBtn,
                          ...(isOnTeleprompter ? modalStyles.teleprompterToggleBtnActive : {}),
                        }}
                        onClick={() => onToggleTeleprompter(clip)}
                        title={
                          isOnTeleprompter
                            ? "Stop showing this on the teleprompter -- go back to the script"
                            : "Show this recording on the teleprompter window instead of the script"
                        }
                        aria-label={
                          isOnTeleprompter
                            ? "Stop showing on teleprompter"
                            : "Show on teleprompter"
                        }
                      >
                        {isOnTeleprompter ? "✕📺" : "📺"}
                      </button>
                    )}
                  </>
                )}
                {onForgetClip && (
                  <button
                    type="button"
                    style={modalStyles.audioToggleBtn}
                    disabled={disableForget}
                    onClick={() => onForgetClip(clip.cameraId, clip.index)}
                    title={
                      disableForget
                        ? "This recording is uploading right now -- can't forget a clip until it finishes"
                        : "Forget this clip completely -- it's dropped from review and upload, even after the camera reconnects"
                    }
                    aria-label={`Forget clip from ${clip.cameraName}`}
                  >
                    🚫
                  </button>
                )}
              </span>
            </div>
          </div>
          );
        })}
      </div>

      {playableClips.length > 0 && (
        <div style={modalStyles.masterControls}>
          <button
            type="button"
            style={modalStyles.masterPlayBtn}
            onClick={handlePlayPause}
            aria-label={isPlaying ? "Pause all cameras" : "Play all cameras"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <span style={modalStyles.masterTime}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <input
            type="range"
            min={0}
            max={Number.isFinite(duration) && duration > 0 ? duration : Math.max(currentTime, 0)}
            step={0.01}
            value={Math.min(currentTime, Number.isFinite(duration) ? duration : currentTime)}
            onChange={(e) => handleSeek(Number(e.target.value))}
            style={modalStyles.masterSeek}
            aria-label="Seek all cameras"
          />
        </div>
      )}
    </div>
  );
}

function RecordingsModal({
  open,
  onClose,
  previews,
  cameraById,
  jobId,
  sessionId,
  transcriptionId,
  attemptAngles,
  attemptCameras,
  currentAssignments,
  attemptValidity,
  onSetValidity,
  discardedAttempts,
  onSetDiscarded,
  forgottenClips,
  onForgetClip,
  uploadedAttempts,
  onAttemptUploaded,
  onUploadComplete,
  disabled,
  postToPrompter,
}: {
  open: boolean;
  onClose: () => void;
  previews: TakePreviews | undefined;
  cameraById: Map<string, DetectedCamera>;
  // Needed (with transcriptionId) to build the upload URL:
  // /jobs/{jobId}/sessions/{sessionId}/transcriptions/{transcriptionId}/videos
  jobId: string;
  sessionId: string;
  // The transcription these recordings belong to -- required to label the
  // upload. Upload is disabled with an explanatory tooltip when this is
  // null (no transcription currently selected).
  transcriptionId: string | null;
  attemptAngles: Record<number, Record<string, ViewAngle>>;
  // Camera hardware metadata captured per attempt (attempt index ->
  // cameraId -> metadata), snapshotted when that attempt started.
  attemptCameras: Record<number, Record<string, CameraMetadata | undefined>>;
  currentAssignments: AngleAssignments;
  // Per-attempt Valid/Invalid marking, set by the operator before
  // uploading. Defaults to `false` (INVALID) for any attempt that hasn't
  // been explicitly marked yet -- the operator has to manually mark the
  // good takes as Valid (see DEFAULT_ATTEMPT_VALIDITY).
  attemptValidity: Record<number, boolean>;
  onSetValidity: (attemptIndex: number, valid: boolean) => void;
  // Attempts the operator has thrown out entirely -- separate from
  // Valid/Invalid. A discarded attempt is never uploaded regardless of
  // its validity marking, and doesn't need one: discarding is for takes
  // you don't even want to review or keep on the backend at all (e.g. a
  // false start), not a third validity state.
  discardedAttempts: Record<number, boolean>;
  onSetDiscarded: (attemptIndex: number, discarded: boolean) => void;
  // Individual camera clips the operator has forgotten, keyed by
  // attempt index -> cameraId -> true. Scoped to ONE camera within ONE
  // attempt (unlike discardedAttempts, which drops a whole attempt) --
  // for a stale/orphaned clip, e.g. one recorded by a camera that's
  // since been disconnected. A forgotten clip is dropped from
  // clipsByIndex entirely, so it's excluded from the grid, from
  // playable/camera counts, and from the upload payload -- as if it was
  // never recorded, even after the camera reconnects.
  forgottenClips: Record<number, Record<string, boolean>>;
  onForgetClip: (attemptIndex: number, cameraId: string, forgotten: boolean) => void;
  // Which attempt indexes (for the CURRENT transcriptionId only) have
  // already been successfully uploaded. Owned by the parent
  // (RecorderPanel), keyed by takeId, and passed down as a plain slice --
  // this is what keeps upload status from leaking between transcriptions
  // (see the FIX note at the top of the file).
  uploadedAttempts: Record<number, boolean>;
  // Fires after an attempt is successfully uploaded. RecorderPanel uses
  // this to (a) record the attempt as uploaded, keyed by takeId, and (b)
  // let an imported video start a fresh imported take instead of being
  // merged into one that's already on the backend.
  onAttemptUploaded?: (attemptIndex: number) => void;
  // Fires once an entire upload run (every queued attempt) finishes
  // successfully, so the session page can refresh its pending/worked
  // lists right away instead of waiting for the next transcription
  // switch.
  onUploadComplete?: () => void;
  // True while the parent session is being ended. Blocks kicking off a
  // brand-new upload run (so nothing new starts sending right as the
  // session closes underneath the operator), but leaves review, marking,
  // discarding, and an already-in-flight upload alone -- there's no
  // reason to strand a transfer that's already going.
  disabled?: boolean;
  // Sends a message on the session's teleprompter BroadcastChannel.
  // Used here only for `videoPreview` show/clear -- every other message
  // type (script, phase, font/speed control) is driven by RecorderPanel
  // itself, not from inside this modal.
  postToPrompter: (msg: PrompterMessage) => void;
}) {
  const clipsByIndex = useMemo(() => {
    const map = new Map<number, RecordingClip[]>();
    Object.entries(previews ?? {}).forEach(([cameraId, segments]) => {
      // Manually imported clips use a pseudo camera id ("manual:Front").
      const isManual = cameraId.startsWith(MANUAL_CAMERA_PREFIX);
      const cameraName = isManual
        ? `${cameraId.slice(MANUAL_CAMERA_PREFIX.length)} (imported)`
        : cameraById.get(cameraId)?.name ?? cameraId;
      segments.forEach((seg) => {
        // Forgotten -- omit entirely, as if this clip was never recorded.
        if (forgottenClips[seg.index]?.[cameraId]) return;
        const list = map.get(seg.index) ?? [];
        list.push({
          key: `${cameraId}-${seg.index}`,
          cameraId,
          cameraName,
          index: seg.index,
          filename: seg.filename,
          url:
            seg.url == null
              ? undefined
              : seg.url.startsWith("http") || seg.url.startsWith("blob:")
              ? seg.url
              : `${AGENT_HTTP_URL}${seg.url}`,
          error: seg.url == null ? seg.error ?? "No clip available" : undefined,
        });
        map.set(seg.index, list);
      });
    });
    return map;
  }, [previews, cameraById, forgottenClips]);

  const indices = useMemo(
    () => Array.from(clipsByIndex.keys()).sort((a, b) => a - b),
    [clipsByIndex]
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      // Prefer the newest recording that hasn't been discarded, so
      // reopening the modal doesn't land you on a take you've already
      // thrown out. Falls back to the newest one overall if everything
      // has been discarded (so it's still viewable/restorable).
      const visible = indices.filter((idx) => !discardedAttempts[idx]);
      setActiveIndex(visible[visible.length - 1] ?? indices[indices.length - 1] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  type UploadPhase = "idle" | "confirming" | "preparing" | "uploading" | "success" | "error";
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The full set of attempt indices queued for this upload run -- built
  // once at "confirming" time from every attempt that has playable
  // clips, NOT just whichever tab happens to be active. This is what
  // makes "Upload" upload everything regardless of the selected tab.
  const [uploadQueue, setUploadQueue] = useState<number[]>([]);
  // Position within uploadQueue currently being sent, for the "Recording
  // X of N" status line.
  const [uploadQueuePos, setUploadQueuePos] = useState(0);
  const uploadCancelRef = useRef<(() => void) | null>(null);
  const uploadAbortedRef = useRef(false);

  // Which clip (if any) is currently being shown on the teleprompter
  // window in place of its script. Purely local UI state -- the
  // teleprompter's own preview state is driven entirely by the
  // `videoPreview` messages posted below, never read back from anywhere.
  const [teleprompterClipKey, setTeleprompterClipKey] = useState<string | null>(null);

  const handleToggleTeleprompter = useCallback(
    (clip: RecordingClip) => {
      if (teleprompterClipKey === clip.key) {
        postToPrompter({ type: "videoPreview", action: "clear" });
        setTeleprompterClipKey(null);
        return;
      }
      if (!clip.url) return;
      postToPrompter({ type: "videoPreview", action: "show", url: clip.url, label: clip.cameraName });
      setTeleprompterClipKey(clip.key);
    },
    [teleprompterClipKey, postToPrompter]
  );

  // FIX: this modal instance is reused across every transcription (only
  // its props change, it's never remounted) -- so any transient,
  // in-progress-upload UI state left over from a PREVIOUS transcription
  // (e.g. still sitting on the "success"/"Upload again" screen, or a
  // half-built queue) must be cleared out whenever the transcription it's
  // showing changes. Per-take upload *completion* is intentionally NOT
  // reset here -- that lives in the parent as `uploadedAttempts`, keyed
  // by takeId, so re-visiting an already-fully-uploaded transcription
  // still correctly shows it as done instead of re-offering upload.
  //
  // Also clears any teleprompter video preview -- it belongs to the
  // transcription we're leaving, and the presenter shouldn't keep
  // looking at transcription A's clip while transcription B is now
  // selected.
  useEffect(() => {
    uploadAbortedRef.current = true;
    uploadCancelRef.current?.();
    uploadCancelRef.current = null;
    setUploadPhase("idle");
    setUploadQueue([]);
    setUploadQueuePos(0);
    setUploadProgress(0);
    setUploadError(null);
    postToPrompter({ type: "videoPreview", action: "clear" });
    setTeleprompterClipKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptionId]);

  // Closing the modal also hands the teleprompter back to the script --
  // there's no view left in which to point at "this clip" once the
  // modal showing it is gone.
  useEffect(() => {
    if (!open && teleprompterClipKey) {
      postToPrompter({ type: "videoPreview", action: "clear" });
      setTeleprompterClipKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // --- Live refs -----------------------------------------------------
  // handleConfirmUpload's for-loop is ONE continuous async function
  // call: once it starts, it's a fixed closure over whatever
  // clipsByIndex/discardedAttempts/attemptValidity/uploadedAttempts WERE
  // at that instant. A later Discard/Forget/Valid-Invalid click updates
  // React state and re-renders (so the UI visibly changes), but that's a
  // NEW render's closure -- the already-running loop never sees it, so a
  // take you just discarded could still get uploaded right in front of
  // you. To fix that, the loop reads these refs (always current, updated
  // every render) instead of the closed-over props/derived values, so a
  // discard/forget/re-mark on a not-yet-processed attempt actually
  // takes effect before its turn comes up.
  const clipsByIndexRef = useRef(clipsByIndex);
  useEffect(() => {
    clipsByIndexRef.current = clipsByIndex;
  }, [clipsByIndex]);

  const discardedAttemptsRef = useRef(discardedAttempts);
  useEffect(() => {
    discardedAttemptsRef.current = discardedAttempts;
  }, [discardedAttempts]);

  const attemptValidityRef = useRef(attemptValidity);
  useEffect(() => {
    attemptValidityRef.current = attemptValidity;
  }, [attemptValidity]);

  const uploadedAttemptsRef = useRef(uploadedAttempts);
  useEffect(() => {
    uploadedAttemptsRef.current = uploadedAttempts;
  }, [uploadedAttempts]);
  // ---------------------------------------------------------------------

  const angleForClip = useCallback(
    (attemptIndex: number, cameraId: string): string =>
      attemptAngles[attemptIndex]?.[cameraId] ??
      angleForCamera(currentAssignments, cameraId) ??
      cameraId,
    [attemptAngles, currentAssignments]
  );

  const cameraForClip = useCallback(
    (attemptIndex: number, cameraId: string): CameraMetadata | null =>
      attemptCameras[attemptIndex]?.[cameraId] ?? cameraById.get(cameraId)?.metadata ?? null,
    [attemptCameras, cameraById]
  );

  // Unmarked attempts fall back to INVALID -- the operator must
  // explicitly mark a recording Valid.
  const isValidForAttempt = useCallback(
    (attemptIndex: number) => attemptValidity[attemptIndex] ?? DEFAULT_ATTEMPT_VALIDITY,
    [attemptValidity]
  );

  const isDiscarded = useCallback(
    (attemptIndex: number) => discardedAttempts[attemptIndex] ?? false,
    [discardedAttempts]
  );

  // Every attempt that has at least one playable clip AND hasn't been
  // discarded -- these are the only ones that can ever be uploaded.
  // Discarding is checked here, once, so nothing downstream (the queue,
  // the confirm dialog, the progress loop) has to think about it again.
  const uploadableIndices = useMemo(
    () =>
      indices.filter(
        (idx) => !isDiscarded(idx) && (clipsByIndex.get(idx) ?? []).some((c) => !!c.url)
      ),
    [indices, clipsByIndex, isDiscarded]
  );
  const notYetUploadedIndices = useMemo(
    () => uploadableIndices.filter((idx) => !uploadedAttempts[idx]),
    [uploadableIndices, uploadedAttempts]
  );

  const handleUploadAllClick = useCallback(() => {
    if (disabled) return;
    // If every attempt has already been uploaded, "upload again" re-queues
    // all of them; otherwise queue just the ones still pending.
    const queue = notYetUploadedIndices.length > 0 ? notYetUploadedIndices : uploadableIndices;
    if (queue.length === 0) return;
    setUploadQueue(queue);
    setUploadQueuePos(0);
    setUploadError(null);
    setUploadPhase("confirming");
  }, [disabled, notYetUploadedIndices, uploadableIndices]);

  const handleCancelConfirm = useCallback(() => {
    setUploadPhase("idle");
    setUploadQueue([]);
  }, []);

  const handleCancelInFlight = useCallback(() => {
    uploadAbortedRef.current = true;
    uploadCancelRef.current?.();
    uploadCancelRef.current = null;
    setUploadPhase("idle");
    setUploadProgress(0);
    setUploadQueue([]);
  }, []);

  const handleConfirmUpload = useCallback(async () => {
    if (!transcriptionId || uploadQueue.length === 0) return;

    uploadAbortedRef.current = false;
    setUploadPhase("uploading");
    setUploadProgress(0);
    setUploadError(null);

    for (let i = 0; i < uploadQueue.length; i++) {
      if (uploadAbortedRef.current) return;
      const attemptIndex = uploadQueue[i];
      setUploadQueuePos(i);

      // Already uploaded (e.g. a retry resuming past an earlier success) --
      // skip straight to the next attempt. Read from the live ref, not
      // the closed-over prop, in case it changed after this loop started.
      if (uploadedAttemptsRef.current[attemptIndex]) continue;

      // Discarded -- check the LIVE ref, not the closed-over prop, so
      // discarding a not-yet-started attempt while this loop is already
      // running actually skips it instead of silently still uploading
      // it because this closure was created before the click happened.
      if (discardedAttemptsRef.current[attemptIndex]) continue;

      // Same reasoning for clips: re-read from the live ref so a clip
      // forgotten after this loop started (but before this attempt's
      // turn) is excluded, not whatever was forgotten/not-forgotten at
      // the moment the loop began.
      const clips = (clipsByIndexRef.current.get(attemptIndex) ?? []).filter((c) => !!c.url);
      if (clips.length === 0) continue;

      try {
        const targets: UploadTakeVideoFile[] = await Promise.all(
          clips.map(async (clip) => ({
            angle: angleForClip(attemptIndex, clip.cameraId),
            filename: clip.filename,
            blob: await fetchClipBlob(clip.url!),
            camera: cameraForClip(attemptIndex, clip.cameraId),
          }))
        );
        if (uploadAbortedRef.current) return;
        // Re-check right after the (possibly slow) blob reads too --
        // the operator may have discarded it while clips were loading.
        if (discardedAttemptsRef.current[attemptIndex]) continue;

        await uploadTakeVideos(
          jobId,
          sessionId,
          transcriptionId,
          targets,
          attemptValidityRef.current[attemptIndex] ?? DEFAULT_ATTEMPT_VALIDITY,
          (fraction) => setUploadProgress(((i + fraction) / uploadQueue.length) * 100),
          (xhr) => {
            uploadCancelRef.current = () => xhr.abort();
          }
        );
        if (uploadAbortedRef.current) return;

        // Tell the parent this attempt is uploaded -- it owns the
        // per-takeId bookkeeping (uploadedAttempts is just a read-only
        // slice passed back down to us).
        onAttemptUploaded?.(attemptIndex);
      } catch (err) {
        if (uploadAbortedRef.current) return;
        const message =
          err instanceof ApiError
            ? `(${err.status}) ${err.message}`
            : err instanceof Error
            ? err.message
            : "Upload failed";
        setUploadError(`${attemptLabel(attemptIndex)}: ${message}`);
        setUploadPhase("error");
        return;
      } finally {
        uploadCancelRef.current = null;
      }
    }

    setUploadProgress(100);
    setUploadPhase("success");
    onUploadComplete?.();
  }, [
    uploadQueue,
    transcriptionId,
    jobId,
    sessionId,
    angleForClip,
    cameraForClip,
    onAttemptUploaded,
    onUploadComplete,
  ]);

  if (!open) return null;

  const activeClips = activeIndex !== null ? clipsByIndex.get(activeIndex) ?? [] : [];

  const confirmClips = uploadQueue
    .filter((attemptIndex) => !isDiscarded(attemptIndex))
    .map((attemptIndex) => ({
      attemptIndex,
      clips: (clipsByIndex.get(attemptIndex) ?? []).filter((c) => !!c.url),
      isValid: isValidForAttempt(attemptIndex),
    }));
  const confirmTotalClips = confirmClips.reduce((sum, c) => sum + c.clips.length, 0);

  const isUploading = uploadPhase === "uploading";
  const currentUploadAttempt = uploadQueue[uploadQueuePos];

  // Counts for the hint text above the tabs (discarded takes are listed
  // separately instead of being lumped into the total).
  const activeIndicesCount = indices.filter((i) => !isDiscarded(i)).length;
  const discardedIndicesCount = indices.length - activeIndicesCount;

  return (
    <div style={modalStyles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={{ margin: 0 }}>Recordings</h3>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={modalStyles.body}>
          {indices.length === 0 ? (
            <p>No recordings yet.</p>
          ) : (
            <>
              {indices.length > 1 && (
                <p style={{ margin: "0 0 0.75rem", fontSize: 13, opacity: 0.7 }}>
                  This transcription has {activeIndicesCount} active recording
                  {activeIndicesCount === 1 ? "" : "s"}
                  {discardedIndicesCount > 0 ? ` (${discardedIndicesCount} discarded)` : ""}. Pick a
                  recording below to play it back — each one plays all its cameras together, in sync.
                </p>
              )}
              {indices.length > 1 && (
                <div style={modalStyles.indexTabs}>
                  {indices.map((idx) => {
                    const clipsInAttempt = clipsByIndex.get(idx) ?? [];
                    const playableCount = clipsInAttempt.filter((c) => !!c.url).length;
                    const forgottenCount = Object.keys(forgottenClips[idx] ?? {}).length;
                    const validHere = isValidForAttempt(idx);
                    const discardedHere = isDiscarded(idx);
                    const uploadedHere = !!uploadedAttempts[idx];
                    return (
                      <div
                        key={idx}
                        style={{ display: "flex", alignItems: "stretch", gap: "0.15rem" }}
                      >
                        <button
                          type="button"
                          style={{
                            ...modalStyles.indexTab,
                            ...(idx === activeIndex ? modalStyles.indexTabActive : {}),
                            ...(discardedHere ? modalStyles.indexTabDiscarded : {}),
                          }}
                          onClick={() => setActiveIndex(idx)}
                        >
                          <span>
                            {attemptLabel(idx)}
                            {discardedHere ? " (discarded)" : uploadedHere ? " ✓" : ""}
                            {!discardedHere && (
                              <span
                                style={
                                  validHere
                                    ? modalStyles.tabValidityDotValid
                                    : modalStyles.tabValidityDotInvalid
                                }
                                title={validHere ? "Marked Valid" : "Marked Invalid"}
                              />
                            )}
                          </span>
                          <span style={modalStyles.indexTabSubtext}>
                            {playableCount} camera{playableCount === 1 ? "" : "s"}
                            {forgottenCount > 0 ? ` · ${forgottenCount} forgotten` : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          style={modalStyles.audioToggleBtn}
                          disabled={uploadedHere || (isUploading && idx === currentUploadAttempt)}
                          title={
                            uploadedHere
                              ? "Already uploaded -- can't discard"
                              : isUploading && idx === currentUploadAttempt
                              ? "This recording is uploading right now -- can't discard until it finishes"
                              : discardedHere
                              ? "Restore this recording so it's included in the upload"
                              : "Discard this recording -- it won't be uploaded"
                          }
                          onClick={() => onSetDiscarded(idx, !discardedHere)}
                        >
                          {discardedHere ? "↺" : "🗑"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {isUploading ? (
                <div style={{ padding: "2rem 0", textAlign: "center", fontSize: 13, opacity: 0.7 }}>
                  Pausing preview while uploading…
                </div>
              ) : (
                <SyncedClipGrid
                  clips={activeClips}
                  onForgetClip={(cameraId, attemptIndex) =>
                    onForgetClip(attemptIndex, cameraId, true)
                  }
                  disableForget={isUploading && activeIndex === currentUploadAttempt}
                  onToggleTeleprompter={handleToggleTeleprompter}
                  teleprompterActiveKey={teleprompterClipKey}
                />
              )}

              {activeIndex !== null && !isUploading && uploadPhase !== "confirming" && (
                isDiscarded(activeIndex) ? (
                  <div style={modalStyles.validityRow}>
                    <span style={modalStyles.errorText}>
                      🗑 This recording is discarded — it will be skipped when you upload.
                    </span>
                    <button
                      type="button"
                      style={modalStyles.confirmCancelBtn}
                      onClick={() => onSetDiscarded(activeIndex, false)}
                    >
                      ↺ Restore
                    </button>
                  </div>
                ) : (
                  <div style={modalStyles.validityRow}>
                    <span style={modalStyles.validityLabel}>Mark this recording as:</span>
                    <div style={modalStyles.validityToggle}>
                      <button
                        type="button"
                        style={{
                          ...modalStyles.validityBtn,
                          ...(isValidForAttempt(activeIndex) ? modalStyles.validityBtnValidActive : {}),
                        }}
                        onClick={() => onSetValidity(activeIndex, true)}
                      >
                        ✓ Valid
                      </button>
                      <button
                        type="button"
                        style={{
                          ...modalStyles.validityBtn,
                          ...(!isValidForAttempt(activeIndex) ? modalStyles.validityBtnInvalidActive : {}),
                        }}
                        onClick={() => onSetValidity(activeIndex, false)}
                      >
                        ✕ Invalid
                      </button>
                    </div>
                    <button
                      type="button"
                      style={modalStyles.confirmCancelBtn}
                      disabled={!!uploadedAttempts[activeIndex]}
                      title={
                        uploadedAttempts[activeIndex]
                          ? "Already uploaded -- can't discard"
                          : "Discard this recording -- it won't be uploaded"
                      }
                      onClick={() => onSetDiscarded(activeIndex, true)}
                    >
                      🗑 Discard
                    </button>
                  </div>
                )
              )}

              {/* Upload is deliberately NOT scoped to `activeIndex` --
                  whichever recording you're currently previewing above,
                  clicking this uploads every recorded attempt for this
                  transcription (each as its own Take on the backend). */}
              <div style={{ marginTop: "0.9rem" }}>
                {uploadPhase === "uploading" ? (
                  <div>
                    <div style={modalStyles.progressStatusRow}>
                      <span>
                        Uploading recording {uploadQueuePos + 1} of {uploadQueue.length}
                        {typeof currentUploadAttempt === "number"
                          ? ` (${attemptLabel(currentUploadAttempt)})`
                          : ""}
                        … {Math.round(uploadProgress)}%
                      </span>
                      <button
                        type="button"
                        style={modalStyles.confirmCancelBtn}
                        onClick={handleCancelInFlight}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={modalStyles.progressTrack}>
                      <div style={{ ...modalStyles.progressFill, width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                ) : uploadPhase === "success" ? (
                  <div style={modalStyles.progressStatusRow}>
                    <span style={modalStyles.successText}>
                      ✓ Uploaded {uploadQueue.length} recording{uploadQueue.length === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      style={modalStyles.confirmCancelBtn}
                      disabled={disabled}
                      title={disabled ? "This session is being ended -- upload is locked" : undefined}
                      onClick={handleUploadAllClick}
                    >
                      Upload again
                    </button>
                  </div>
                ) : uploadPhase === "error" ? (
                  <div>
                    <p style={modalStyles.errorText}>⚠ {uploadError}</p>
                    <button type="button" style={modalStyles.uploadBtn} onClick={handleConfirmUpload}>
                      Retry remaining uploads
                    </button>
                  </div>
                ) : uploadPhase !== "confirming" ? (
                  <button
                    type="button"
                    style={{
                      ...modalStyles.uploadBtn,
                      ...(disabled || !transcriptionId || uploadableIndices.length === 0
                        ? modalStyles.uploadBtnDisabled
                        : {}),
                      ...(!disabled && notYetUploadedIndices.length === 0 && uploadableIndices.length > 0
                        ? modalStyles.uploadBtnDone
                        : {}),
                    }}
                    disabled={disabled || !transcriptionId || uploadableIndices.length === 0}
                    title={
                      disabled
                        ? "This session is being ended -- upload is locked"
                        : !transcriptionId
                        ? "No transcription is selected -- can't upload without one"
                        : uploadableIndices.length === 0
                        ? indices.length > 0
                          ? "Every recording has been discarded -- restore one to upload"
                          : "No playable clips in any recording yet"
                        : "Uploads every non-discarded recording for this transcription, not just the one you're viewing"
                    }
                    onClick={handleUploadAllClick}
                  >
                    {notYetUploadedIndices.length === 0
                      ? `↻ Upload all recordings again (${uploadableIndices.length})`
                      : `⬆ Upload all recordings (${notYetUploadedIndices.length})`}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {uploadPhase === "confirming" && uploadQueue.length > 0 && (
        <div style={modalStyles.confirmOverlay} onClick={handleCancelConfirm}>
          <div style={modalStyles.confirmBox} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: 0 }}>
              Upload {confirmClips.length} recording{confirmClips.length === 1 ? "" : "s"}?
            </h4>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
              This uploads {confirmTotalClips} video{confirmTotalClips === 1 ? "" : "s"} across every
              recorded take for this transcription -- not just the one you were previewing. Each
              recording becomes its own take on the backend, marked Valid or Invalid as set below.
              This can&apos;t be undone from here.
            </p>
            <ul style={modalStyles.confirmList}>
              {confirmClips.map(({ attemptIndex, clips, isValid }) => (
                <li key={attemptIndex} style={modalStyles.confirmListItem}>
                  <span>
                    {attemptLabel(attemptIndex)} · {clips.length} camera{clips.length === 1 ? "" : "s"}
                  </span>
                  <strong style={{ color: isValid ? "#34c759" : "#ff6b6b" }}>
                    {isValid ? "Valid" : "Invalid"}
                  </strong>
                </li>
              ))}
            </ul>
            <div style={modalStyles.confirmActions}>
              <button type="button" style={modalStyles.confirmCancelBtn} onClick={handleCancelConfirm}>
                Cancel
              </button>
              <button type="button" style={modalStyles.uploadBtn} onClick={handleConfirmUpload}>
                Confirm &amp; Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// RecorderPanel
// ---------------------------------------------------------------------

interface RecorderPanelProps {
  jobId: string;
  sessionId: string;
  transcription: TranscriptionRow | null;
  // Lets the session page disable transcription switching in the
  // sidebar while a countdown/recording is in flight, so the operator
  // can't yank the rug out from under an in-progress take.
  onBusyChange?: (busy: boolean) => void;
  // True while the parent session is in the process of being ended
  // (endJobSession is in flight). Blocks starting anything NEW --
  // recording, camera (re)assignment, manual video import, a fresh
  // upload run -- so nothing kicks off right as the session closes out
  // from under the operator. Deliberately does NOT touch Stop or the
  // ability to review/mark/watch recordings already sitting in the
  // Recordings modal: if a take is already rolling when "End session"
  // is clicked, the operator can still stop it and wrap up cleanly. Once
  // the session actually finishes ending, the page swaps to the
  // read-only history view and this panel unmounts entirely.
  disabled?: boolean;
  // Fires once a full upload run for the currently selected
  // transcription finishes successfully, so the session page can
  // refresh its pending/"done in this session" lists immediately
  // instead of only on the next transcription switch.
  onUploadComplete?: () => void;
}

export default function RecorderPanel({
  jobId,
  sessionId,
  transcription,
  onBusyChange,
  disabled = false,
  onUploadComplete,
}: RecorderPanelProps) {
  const {
    status: agentStatus,
    cameras,
    previewState,
    recordingState: agentRecordingState,
    lastRecordingResult,
    lastError,
    clearError,
    startRecording,
    stopRecording,
    startPreview,
    stopPreview,
  } = useAgentConnection();

  const [assignments, setAssignments] = useState<AngleAssignments>({});
  useEffect(() => {
    setAssignments(loadAssignments());
  }, []);

  const [angleHistory, setAngleHistory] = useState<Record<string, ViewAngle>>({});
  useEffect(() => {
    setAngleHistory(loadAngleHistory());
  }, []);

  const unassignedCameras = useMemo(
    () => cameras.filter((cam) => !angleForCamera(assignments, cam.id)),
    [cameras, assignments]
  );

  const handleAssign = useCallback((angle: ViewAngle, cameraId: string) => {
    setAssignments((prev) => {
      const next = { ...prev, [angle]: cameraId };
      saveAssignments(next);
      return next;
    });
    setAngleHistory((prev) => {
      const next = { ...prev, [cameraId]: angle };
      saveAngleHistory(next);
      return next;
    });
  }, []);

  const handleClearAssignment = useCallback((angle: ViewAngle) => {
    setAssignments((prev) => {
      const cameraId = prev[angle];
      const next = { ...prev };
      delete next[angle];
      saveAssignments(next);

      if (cameraId) {
        setAngleHistory((prevHistory) => {
          if (!(cameraId in prevHistory)) return prevHistory;
          const nextHistory = { ...prevHistory };
          delete nextHistory[cameraId];
          saveAngleHistory(nextHistory);
          return nextHistory;
        });
      }

      return next;
    });
  }, []);

  const cameraById = useMemo(() => {
    const map = new Map<string, DetectedCamera>();
    cameras.forEach((c) => map.set(c.id, c));
    return map;
  }, [cameras]);

  const connectedCameraIds = useMemo(() => new Set(cameras.map((c) => c.id)), [cameras]);

  useEffect(() => {
    const releasedAngles: ViewAngle[] = [];
    const historyUpdates: Record<string, ViewAngle> = {};
    KNOWN_ANGLES.forEach((angle) => {
      const cameraId = assignments[angle];
      if (cameraId && !connectedCameraIds.has(cameraId)) {
        releasedAngles.push(angle);
        historyUpdates[cameraId] = angle;
      }
    });
    if (releasedAngles.length === 0) return;

    setAssignments((prev) => {
      const next = { ...prev };
      releasedAngles.forEach((angle) => delete next[angle]);
      saveAssignments(next);
      return next;
    });
    setAngleHistory((prev) => {
      const next = { ...prev, ...historyUpdates };
      saveAngleHistory(next);
      return next;
    });
  }, [connectedCameraIds, assignments]);

  useEffect(() => {
    const updates: Partial<AngleAssignments> = {};
    cameras.forEach((cam) => {
      const historicalAngle = angleHistory[cam.id];
      if (!historicalAngle) return;
      if (angleForCamera(assignments, cam.id)) return;
      if (assignments[historicalAngle]) return;
      updates[historicalAngle] = cam.id;
    });
    if (Object.keys(updates).length === 0) return;

    setAssignments((prev) => {
      const next = { ...prev, ...updates };
      saveAssignments(next);
      return next;
    });
  }, [cameras, angleHistory, assignments]);

  // ---- takeId: the currently selected transcription's id. Recording,
  // uploads, and attemptAngles are all grouped by this. ----
  const takeId = transcription?.transcription_id ?? null;

  // ---- Recording phase state machine ----
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  useEffect(() => {
    onBusyChange?.(phase === "countdown" || phase === "recording");
  }, [phase, onBusyChange]);

  useEffect(() => {
    if (!lastError) return;
    if (phase === "countdown" || phase === "recording") {
      setPhase("idle");
      postToPrompterRef.current?.({ type: "phase", phase: "idle" });
    }
  }, [lastError, phase]);

  const [mockRunning, setMockRunning] = useState(false);

  // ---- Script for the teleprompter: whatever's already loaded on the
  // selected transcription -- no fetch needed. ----
  const script = transcription?.text ?? NO_SELECTION_SCRIPT;
  const scriptLines = useMemo(() => script.split("\n"), [script]);

  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  const handleFontDecrease = useCallback(() => {
    setFontSize((prev) => Math.max(MIN_FONT_SIZE, prev - FONT_STEP));
  }, []);
  const handleFontIncrease = useCallback(() => {
    setFontSize((prev) => Math.min(MAX_FONT_SIZE, prev + FONT_STEP));
  }, []);

  const [prompterConnected, setPrompterConnected] = useState(false);
  const [scrollStatus, setScrollStatus] = useState<{ lineIndex: number; totalLines: number } | null>(
    null
  );
  const lastMonitorLineRef = useRef<number>(-1);

  const [prompterWindowInfo, setPrompterWindowInfo] = useState<{
    width: number;
    height: number;
    fontSize: number;
  } | null>(null);
  const teleprompterWindowRef = useRef<Window | null>(null);

  const previewBoxRef = useRef<HTMLDivElement | null>(null);

  const handlePrompterMessage = useCallback((msg: PrompterMessage) => {
    if (msg.type === "windowReady") {
      setPrompterConnected(true);
    } else if (msg.type === "scrollStatus") {
      if (msg.lineIndex !== lastMonitorLineRef.current) {
        lastMonitorLineRef.current = msg.lineIndex;
        setScrollStatus({ lineIndex: msg.lineIndex, totalLines: msg.totalLines });
      }
      const el = previewBoxRef.current;
      if (el && typeof msg.scrollFraction === "number") {
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = msg.scrollFraction * maxScroll;
      }
    } else if (msg.type === "windowInfo") {
      setPrompterWindowInfo({
        width: msg.innerWidth,
        height: msg.innerHeight,
        fontSize: msg.effectiveFontSize,
      });
    }
  }, []);

  // Channel keyed by SESSION id (not takeId) -- see file header. Stays
  // connected across transcription switches.
  const postToPrompter = useTeleprompterChannel(sessionId, handlePrompterMessage);

  const postToPrompterRef = useRef(postToPrompter);
  useEffect(() => {
    postToPrompterRef.current = postToPrompter;
  }, [postToPrompter]);

  const handleOpenTeleprompter = useCallback(() => {
    const win = window.open(
      `/teleprompter/${jobId}/${sessionId}`,
      "session-teleprompter",
      "width=900,height=600"
    );
    teleprompterWindowRef.current = win;
  }, [jobId, sessionId]);

  // Push the current script/font/speed whenever the popup is connected
  // and any of them change -- this is also what handles switching to a
  // different transcription while the popup stays open: `script`
  // changes, this effect fires, the popup gets a new "script" message.
  useEffect(() => {
    if (!prompterConnected) return;
    postToPrompter({ type: "script", text: script });
    postToPrompter({ type: "control", action: "setFontSize", fontSize });
    postToPrompter({ type: "control", action: "setSpeed", speed });
  }, [prompterConnected, script, fontSize, speed, postToPrompter]);

  const [previewBoxWidth, setPreviewBoxWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPreviewBoxWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const monitorFontSize =
    prompterWindowInfo && previewBoxWidth
      ? Math.max(10, prompterWindowInfo.fontSize * (previewBoxWidth / prompterWindowInfo.width))
      : Math.max(12, fontSize * 0.4);

  const assignedCameraCount = KNOWN_ANGLES.filter((angle) => assignments[angle]).length;
  const hasAssignedCamera = assignedCameraCount > 0;

  const assignedCameraIds = useMemo(
    () => KNOWN_ANGLES.map((angle) => assignments[angle]).filter((id): id is string => !!id),
    [assignments]
  );

  // ---- Per-attempt camera -> angle mapping, keyed by takeId then
  // attempt index -- different transcriptions must never share attempt
  // numbering, since the agent's attemptIndex counts from 0 per takeId. ----
  const [attemptAnglesByTake, setAttemptAnglesByTake] = useState<
    Record<string, Record<number, Record<string, ViewAngle>>>
  >({});
  const pendingAttemptAnglesRef = useRef<Record<string, ViewAngle> | null>(null);

  // Same idea for camera hardware metadata: snapshotted at the moment
  // recording starts (the agent's camera list can change afterwards, e.g.
  // a camera unplugged), then filed under the attempt index once the
  // agent reports which attempt it was.
  const pendingAttemptCamerasRef = useRef<Record<string, CameraMetadata | undefined> | null>(null);
  const [attemptCamerasByTake, setAttemptCamerasByTake] = useState<
    Record<string, Record<number, Record<string, CameraMetadata | undefined>>>
  >({});

  useEffect(() => {
    if (!lastRecordingResult || !takeId || lastRecordingResult.takeId !== takeId) return;
    const attemptIndex = lastRecordingResult.attemptIndex;
    if (attemptIndex == null) return;
    if (attemptAnglesByTake[takeId]?.[attemptIndex]) return; // already recorded
    if (!pendingAttemptAnglesRef.current) return;
    const captured = pendingAttemptAnglesRef.current;
    const capturedCameras = pendingAttemptCamerasRef.current ?? {};
    pendingAttemptAnglesRef.current = null;
    pendingAttemptCamerasRef.current = null;
    setAttemptAnglesByTake((prev) => ({
      ...prev,
      [takeId]: { ...(prev[takeId] ?? {}), [attemptIndex]: captured },
    }));
    setAttemptCamerasByTake((prev) => ({
      ...prev,
      [takeId]: { ...(prev[takeId] ?? {}), [attemptIndex]: capturedCameras },
    }));
  }, [lastRecordingResult, takeId, attemptAnglesByTake]);

  const attemptAngles = takeId ? attemptAnglesByTake[takeId] ?? {} : {};
  const attemptCameras = takeId ? attemptCamerasByTake[takeId] ?? {} : {};

  // ---- Per-attempt Valid/Invalid marking, keyed by takeId then attempt
  // index, same shape as attemptAnglesByTake -- so switching between
  // transcriptions never leaks one recording's marking onto another's.
  // Only attempts the operator has explicitly touched appear here; every
  // other attempt is treated as INVALID by default (see
  // DEFAULT_ATTEMPT_VALIDITY). ----
  const [attemptValidityByTake, setAttemptValidityByTake] = useState<
    Record<string, Record<number, boolean>>
  >({});

  const attemptValidity = takeId ? attemptValidityByTake[takeId] ?? {} : {};

  const handleSetValidity = useCallback(
    (attemptIndex: number, valid: boolean) => {
      if (!takeId) return;
      setAttemptValidityByTake((prev) => ({
        ...prev,
        [takeId]: { ...(prev[takeId] ?? {}), [attemptIndex]: valid },
      }));
    },
    [takeId]
  );

  // ---- Per-attempt discard flag, same shape/keying as
  // attemptValidityByTake -- separate from Valid/Invalid on purpose. A
  // discarded attempt is dropped from the upload set entirely and never
  // sent to the backend, regardless of how (or whether) it's marked. ----
  const [discardedByTake, setDiscardedByTake] = useState<Record<string, Record<number, boolean>>>(
    {}
  );

  const discardedAttempts = takeId ? discardedByTake[takeId] ?? {} : {};

  const handleSetDiscarded = useCallback(
    (attemptIndex: number, discarded: boolean) => {
      if (!takeId) return;
      setDiscardedByTake((prev) => ({
        ...prev,
        [takeId]: { ...(prev[takeId] ?? {}), [attemptIndex]: discarded },
      }));
    },
    [takeId]
  );

  // ---- Per-attempt, per-camera "forgotten" clips -- keyed one level
  // deeper than attemptValidityByTake/discardedByTake (takeId -> attempt
  // index -> cameraId), since this drops ONE camera's clip from ONE
  // attempt rather than the whole attempt. Once forgotten, that clip is
  // excluded from clipsByIndex entirely (see RecordingsModal), so it
  // disappears from the grid, from playable/camera counts, and from
  // what gets uploaded -- even if the camera that recorded it later
  // reconnects and its clip would otherwise still be sitting in
  // `previews`. This is separate from discardedAttempts (which drops an
  // entire take) because a single stale/orphaned clip from a
  // disconnected camera doesn't mean the rest of that take is bad. ----
  const [forgottenClipsByTake, setForgottenClipsByTake] = useState<
    Record<string, Record<number, Record<string, boolean>>>
  >({});

  const forgottenClips = takeId ? forgottenClipsByTake[takeId] ?? {} : {};

  const handleForgetClip = useCallback(
    (attemptIndex: number, cameraId: string, forgotten: boolean) => {
      if (!takeId) return;
      setForgottenClipsByTake((prev) => {
        const forTake = prev[takeId] ?? {};
        const forAttempt = { ...(forTake[attemptIndex] ?? {}) };
        if (forgotten) {
          forAttempt[cameraId] = true;
        } else {
          delete forAttempt[cameraId];
        }
        return { ...prev, [takeId]: { ...forTake, [attemptIndex]: forAttempt } };
      });
    },
    [takeId]
  );

  // ---- Per-attempt "uploaded" flag, keyed by takeId then attempt index --
  // same shape/keying as attemptValidityByTake/discardedByTake. This is
  // the FIX for uploads "bleeding" between transcriptions: it used to
  // live as a bare `useState<Set<number>>` inside RecordingsModal, which
  // is never remounted when the selected transcription changes, so a
  // later transcription's attempt 0 could show as "already uploaded"
  // just because an earlier transcription's attempt 0 had been. Keying
  // it here by takeId (like every other per-attempt marking) means each
  // transcription only ever sees its own uploaded attempts. ----
  const [uploadedAttemptsByTake, setUploadedAttemptsByTake] = useState<
    Record<string, Record<number, boolean>>
  >({});

  const uploadedAttempts = takeId ? uploadedAttemptsByTake[takeId] ?? {} : {};

  const handleMarkUploaded = useCallback(
    (attemptIndex: number) => {
      if (!takeId) return;
      setUploadedAttemptsByTake((prev) => ({
        ...prev,
        [takeId]: { ...(prev[takeId] ?? {}), [attemptIndex]: true },
      }));
    },
    [takeId]
  );

  const resetPrompterToStart = useCallback(() => {
    postToPrompter({ type: "phase", phase: "idle" });
    postToPrompter({ type: "control", action: "jumpToStart" });
    lastMonitorLineRef.current = -1;
    setScrollStatus(null);
    if (previewBoxRef.current) previewBoxRef.current.scrollTop = 0;
  }, [postToPrompter]);

  // Switching to a different transcription (only possible while idle --
  // the sidebar is disabled during countdown/recording via onBusyChange)
  // should reset the popup's scroll back to the top of the NEW script,
  // rather than leaving it wherever the previous script's scroll was.
  useEffect(() => {
    if (!prompterConnected) return;
    resetPrompterToStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeId]);

  const handleMockRunToggle = useCallback(() => {
    if (mockRunning) {
      setMockRunning(false);
      resetPrompterToStart();
    } else {
      resetPrompterToStart();
      postToPrompter({ type: "phase", phase: "recording" });
      setMockRunning(true);
    }
  }, [mockRunning, postToPrompter, resetPrompterToStart]);

  const handleStartClick = useCallback(() => {
    if (!hasAssignedCamera || !takeId || disabled) return;
    if (mockRunning) {
      setMockRunning(false);
      resetPrompterToStart();
    }
    clearError();
    setPhase("countdown");
    postToPrompter({ type: "phase", phase: "countdown" });
  }, [hasAssignedCamera, takeId, disabled, mockRunning, postToPrompter, resetPrompterToStart, clearError]);

  const handleCountdownTick = useCallback(
    (value: number) => {
      setCountdownValue(value);
      postToPrompter({ type: "phase", phase: "countdown", countdownValue: value });
    },
    [postToPrompter]
  );

  const handleCountdownComplete = useCallback(() => {
    if (!takeId) return;
    setCountdownValue(null);
    setPhase("recording");
    pendingAttemptAnglesRef.current = assignedCameraIds.reduce<Record<string, ViewAngle>>(
      (acc, cameraId) => {
        const angle = angleForCamera(assignments, cameraId);
        if (angle) acc[cameraId] = angle;
        return acc;
      },
      {}
    );
    pendingAttemptCamerasRef.current = assignedCameraIds.reduce<
      Record<string, CameraMetadata | undefined>
    >((acc, cameraId) => {
      acc[cameraId] = cameraById.get(cameraId)?.metadata;
      return acc;
    }, {});
    startRecording(takeId, assignedCameraIds);
    postToPrompter({ type: "phase", phase: "recording" });
  }, [startRecording, takeId, assignedCameraIds, assignments, cameraById, postToPrompter]);

  const handleStopClick = useCallback(() => {
    setPhase("stopped");
    stopRecording();
    postToPrompter({ type: "phase", phase: "stopped" });
  }, [stopRecording, postToPrompter]);

  useEffect(() => {
    if (phase === "stopped" && agentRecordingState === "idle") {
      setPhase("idle");
    }
  }, [phase, agentRecordingState]);

  const takeResult =
    lastRecordingResult && takeId && lastRecordingResult.takeId === takeId ? lastRecordingResult : null;

  const recordingAttemptCount = useMemo(() => {
    if (!takeResult) return 0;
    const seen = new Set<number>();
    Object.values(takeResult.previews).forEach((segs) => segs.forEach((s) => seen.add(s.index)));
    return seen.size;
  }, [takeResult]);

  const [recordingsModalOpen, setRecordingsModalOpen] = useState(false);

  // ---- Manual video import (per angle slot) ----
  // Files the operator adds by hand (e.g. footage already copied off a
  // GoPro). Held as blob: URLs, grouped into "imported takes" under
  // attempt indexes >= MANUAL_ATTEMPT_BASE, then merged into the same
  // previews/attemptAngles shapes the agent's recordings use so the
  // Recordings modal and upload pipeline treat them identically.
  const [manualByTake, setManualByTake] = useState<ManualByTake>({});
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importAngleRef = useRef<ViewAngle | null>(null);
  const uploadedManualRef = useRef<Set<string>>(new Set());
  const manualUrlsRef = useRef<Set<string>>(new Set());

  // Free the blob URLs when the panel unmounts.
  useEffect(() => {
    const urls = manualUrlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const handleImportClick = useCallback(
    (angle: ViewAngle) => {
      if (disabled) return;
      importAngleRef.current = angle;
      importInputRef.current?.click();
    },
    [disabled]
  );

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow picking the same file again
      const angle = importAngleRef.current;
      if (!file || !angle || !takeId || disabled) return;

      if (!file.type.startsWith("video/")) {
        setImportError(`"${file.name}" isn't a video file.`);
        return;
      }
      setImportError(null);

      const url = URL.createObjectURL(file);
      manualUrlsRef.current.add(url);
      const clip: ManualClip = { filename: file.name, url };

      setManualByTake((prev) => {
        const forTake = prev[takeId] ?? {};
        const idxs = Object.keys(forTake)
          .map(Number)
          .sort((a, b) => a - b);
        const latest = idxs[idxs.length - 1];
        // Reuse the latest imported take when this angle is still empty in
        // it and it hasn't been uploaded yet, so e.g. a Front + a Side
        // file upload together as one Take. Otherwise start a new one.
        const canReuse =
          latest !== undefined &&
          !forTake[latest][angle] &&
          !uploadedManualRef.current.has(`${takeId}:${latest}`);
        const target = canReuse ? latest : MANUAL_ATTEMPT_BASE + idxs.length;
        return {
          ...prev,
          [takeId]: { ...forTake, [target]: { ...(forTake[target] ?? {}), [angle]: clip } },
        };
      });

      // Defaults to INVALID like every other take; the operator reviews
      // and marks it Valid in the modal before uploading.
      setRecordingsModalOpen(true);
    },
    [takeId, disabled]
  );

  // Fires once RecordingsModal confirms an attempt uploaded successfully.
  // Marks it uploaded in the per-takeId map above (fixing the
  // cross-transcription leak) AND, for manual imports specifically, marks
  // it so the next imported video for this angle starts a fresh take
  // rather than being merged into one already on the backend.
  const handleAttemptUploaded = useCallback(
    (attemptIndex: number) => {
      if (takeId) uploadedManualRef.current.add(`${takeId}:${attemptIndex}`);
      handleMarkUploaded(attemptIndex);
    },
    [takeId, handleMarkUploaded]
  );

  const manualForTake = takeId ? manualByTake[takeId] ?? {} : {};
  const manualAttemptCount = Object.keys(manualForTake).length;

  // Merge imported clips into the same shapes the modal already consumes,
  // using a pseudo camera id per angle ("manual:Front").
  const mergedPreviews = useMemo<TakePreviews | undefined>(() => {
    if (manualAttemptCount === 0) return takeResult?.previews;
    const out: TakePreviews = { ...(takeResult?.previews ?? {}) };
    Object.entries(manualForTake).forEach(([idxStr, byAngle]) => {
      const index = Number(idxStr);
      Object.entries(byAngle).forEach(([angle, clip]) => {
        const camId = `${MANUAL_CAMERA_PREFIX}${angle}`;
        out[camId] = [...(out[camId] ?? []), { index, filename: clip.filename, url: clip.url }];
      });
    });
    return out;
  }, [takeResult, manualForTake, manualAttemptCount]);

  const mergedAttemptAngles = useMemo(() => {
    const out: Record<number, Record<string, ViewAngle>> = { ...attemptAngles };
    Object.entries(manualForTake).forEach(([idxStr, byAngle]) => {
      const m: Record<string, ViewAngle> = {};
      Object.keys(byAngle).forEach((angle) => {
        m[`${MANUAL_CAMERA_PREFIX}${angle}`] = angle as ViewAngle;
      });
      out[Number(idxStr)] = m;
    });
    return out;
  }, [attemptAngles, manualForTake]);

  // Raw number of attempts that exist for this transcription, discarded or
  // not. Used only to decide whether the modal has anything to open.
  const totalAttemptCount = recordingAttemptCount + manualAttemptCount;

  // Attempts that still count: not discarded, and with at least one clip
  // that hasn't been forgotten. This is what the "View Recordings (N)"
  // button shows, so discarding a take (or forgetting its last clip)
  // lowers the number.
  const activeAttemptCount = useMemo(() => {
    const live = new Set<number>();
    Object.entries(mergedPreviews ?? {}).forEach(([cameraId, segs]) => {
      segs.forEach((seg) => {
        if (discardedAttempts[seg.index]) return;
        if (forgottenClips[seg.index]?.[cameraId]) return;
        live.add(seg.index);
      });
    });
    return live.size;
  }, [mergedPreviews, discardedAttempts, forgottenClips]);

  // Of the active attempts above, how many are still awaiting upload.
  // This is what makes the button reflect "done" once every active
  // recording for this transcription has actually been uploaded --
  // previously the badge only ever showed activeAttemptCount, so it kept
  // showing e.g. "(5)" even after all 5 had been successfully uploaded.
  const pendingUploadCount = useMemo(() => {
    const live = new Set<number>();
    Object.entries(mergedPreviews ?? {}).forEach(([cameraId, segs]) => {
      segs.forEach((seg) => {
        if (discardedAttempts[seg.index]) return;
        if (forgottenClips[seg.index]?.[cameraId]) return;
        if (uploadedAttempts[seg.index]) return;
        live.add(seg.index);
      });
    });
    return live.size;
  }, [mergedPreviews, discardedAttempts, forgottenClips, uploadedAttempts]);

  const discardedAttemptCount = Math.max(0, totalAttemptCount - activeAttemptCount);
  const allActiveUploaded = activeAttemptCount > 0 && pendingUploadCount === 0;

  // Applied to the panel's interactive content (but NOT to RecordingsModal,
  // which is `position: fixed` -- a CSS `filter` on an ancestor turns it
  // into a containing block for fixed descendants, which would shrink/clip
  // the modal to this panel's box instead of the viewport). `pointerEvents:
  // "none"` here is the real lock; the per-control `disabled` props
  // elsewhere are a belt-and-suspenders backstop (keyboard nav, screen
  // readers, and the disabled visual state browsers render on the controls
  // themselves).
  const disabledOverlayStyle: React.CSSProperties = disabled
    ? {
        filter: "blur(3px)",
        opacity: 0.55,
        pointerEvents: "none",
        userSelect: "none",
        transition: "filter 150ms ease, opacity 150ms ease",
      }
    : { transition: "filter 150ms ease, opacity 150ms ease" };

  return (
    <div className={styles.panel} style={{ position: "relative" }}>
      <div style={disabledOverlayStyle}>
      {lastError && (
        <div className={styles.assignPanel} role="alert">
          <p className={styles.assignHint}>⚠ {lastError}</p>
        </div>
      )}

      {importError && (
        <div className={styles.assignPanel} role="alert">
          <p className={styles.assignHint}>⚠ {importError}</p>
        </div>
      )}

      <div className={styles.contentGrid}>
        <div className={styles.mainColumn}>
          <div className={styles.header}>
            <h2 className={styles.title}>
              {transcription ? `Recording — #${transcription.row_number ?? ""}`.trimEnd() : "Recording"}
            </h2>
            <div className={styles.headerBadges}>
              <span
                className={styles.agentBadge}
                data-status={agentStatus}
                title={`Agent: ${agentStatus}`}
              >
                ● Agent {agentStatus}
              </span>
              <span className={styles.cameraCountBadge} title="Cameras currently connected to the agent">
                📷 {cameras.length} connected
              </span>
            </div>
          </div>

          {!transcription && (
            <section className={styles.assignPanel}>
              <p className={styles.assignHint}>
                Select a transcription on the left to record against it.
              </p>
            </section>
          )}

          {unassignedCameras.length > 0 && (
            <section className={styles.assignPanel}>
              <h3 className={styles.assignTitle}>Assign cameras to angles</h3>
              <p className={styles.assignHint}>
                These cameras haven&apos;t been assigned yet. Once set, this is remembered — you
                won&apos;t be asked again for the same camera.
              </p>
              <div className={styles.assignGrid}>
                {unassignedCameras.map((cam) => (
                  <div key={cam.id} className={styles.assignRow}>
                    <span className={styles.assignCamName}>{cam.name}</span>
                    <div className={styles.assignButtons}>
                      {KNOWN_ANGLES.map((angle) => (
                        <button
                          key={angle}
                          type="button"
                          className={styles.assignBtn}
                          disabled={disabled || !!assignments[angle]}
                          onClick={() => handleAssign(angle, cam.id)}
                        >
                          {assignments[angle] ? `${angle} (taken)` : angle}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={styles.stage}>
            {phase === "countdown" && (
              <CountdownOverlay onTick={handleCountdownTick} onComplete={handleCountdownComplete} />
            )}

            <div className={styles.grid}>
              {KNOWN_ANGLES.map((angle) => {
                const cameraId = assignments[angle];
                const camera = cameraId ? cameraById.get(cameraId) : undefined;
                const isPreviewingThis = previewState?.cameraId === cameraId;
                const previewBusyElsewhere = !!previewState && previewState.cameraId !== cameraId;

                return (
                  <div key={angle} className={styles.slot} data-slot={angle}>
                    <span className={styles.slotLabel}>{angle}</span>
                    <div className={styles.feedBox}>
                      {!cameraId ? (
                        <p className={styles.feedEmptyText}>No camera assigned</p>
                      ) : !camera ? (
                        <p className={styles.feedEmptyText}>Camera not detected</p>
                      ) : isPreviewingThis && previewState?.state === "ready" ? (
                        <MjpegStream
                          className={styles.feedPreviewImg}
                          src={`${AGENT_HTTP_URL}/stream/${cameraId}`}
                          alt={`Live preview: ${camera.name}`}
                        />
                      ) : (
                        <div className={styles.feedPlaceholder}>
                          <span>{camera.name}</span>
                          <span className={styles.feedLivePill}>
                            {phase === "recording"
                              ? "● REC"
                              : isPreviewingThis && previewState?.state === "starting"
                              ? "connecting…"
                              : "live preview"}
                          </span>
                        </div>
                      )}
                      {cameraId && camera && phase !== "recording" && (
                        <button
                          type="button"
                          className={styles.previewToggleBtn}
                          disabled={disabled || previewBusyElsewhere}
                          title={
                            disabled
                              ? "This session is being ended -- preview is locked"
                              : previewBusyElsewhere
                              ? "Only one live preview can run at a time — stop the other one first"
                              : undefined
                          }
                          onClick={() =>
                            isPreviewingThis ? stopPreview(cameraId) : startPreview(cameraId)
                          }
                        >
                          {isPreviewingThis ? "■ Stop preview" : "▶ Preview"}
                        </button>
                      )}
                      {cameraId && (
                        <button
                          type="button"
                          className={styles.reassignBtn}
                          disabled={disabled}
                          onClick={() => handleClearAssignment(angle)}
                          title={disabled ? "This session is being ended" : "Unassign this camera"}
                        >
                          Unassign
                        </button>
                      )}
                    </div>

                    {/* Manual import: add a video file for this angle. */}
                    {takeId && !disabled && phase !== "recording" && phase !== "countdown" && (
                      <button
                        type="button"
                        style={importBtnStyle}
                        onClick={() => handleImportClick(angle)}
                        title={`Add a video file for the ${angle} angle`}
                      >
                        ⬆ Add video
                      </button>
                    )}
                    {(() => {
                      const latest = Object.keys(manualForTake)
                        .map(Number)
                        .sort((a, b) => b - a)
                        .map((i) => manualForTake[i][angle])
                        .find(Boolean);
                      return latest ? (
                        <span style={{ fontSize: 11, opacity: 0.7 }}>📎 {latest.filename}</span>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.telePreviewFloating}>
          <span className={styles.slotLabel}>Teleprompter</span>
          <div
            className={styles.telePreviewBox}
            style={
              prompterWindowInfo
                ? { aspectRatio: `${prompterWindowInfo.width} / ${prompterWindowInfo.height}` }
                : undefined
            }
          >
            {!prompterConnected ? (
              <p className={styles.feedEmptyText}>Popup not connected</p>
            ) : (
              <div className={styles.telePreviewScroll} ref={previewBoxRef}>
                {scriptLines.map((line, i) => (
                  <div
                    key={i}
                    className={styles.telePreviewLine}
                    style={{
                      fontSize: `${monitorFontSize}px`,
                      opacity: scrollStatus?.lineIndex === i ? 1 : 0.4,
                      fontWeight: scrollStatus?.lineIndex === i ? 700 : 500,
                    }}
                  >
                    {line || "\u00A0"}
                  </div>
                ))}
              </div>
            )}
            <span className={styles.feedLivePill}>
              {phase === "recording" ? "● REC" : mockRunning ? "▶ mock run" : "live preview"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.controlsRow}>
        <button
          type="button"
          className={styles.recordBtn}
          onClick={handleStartClick}
          disabled={
            !hasAssignedCamera || !takeId || disabled || phase === "countdown" || phase === "recording"
          }
          title={
            disabled
              ? "This session is being ended -- recording is locked"
              : !takeId
              ? "Select a transcription first"
              : undefined
          }
        >
          {phase === "recording" ? "Recording…" : "● Record"}
        </button>
        <button
          type="button"
          className={styles.stopBtn}
          onClick={handleStopClick}
          disabled={phase !== "recording"}
        >
          ■ Stop
        </button>
        {/* Stays clickable even when the active count drops to 0, so a
            discarded take can still be opened and restored. Badge now
            shows how many active recordings still need uploading, and a
            checkmark once every active recording has been uploaded --
            instead of always showing the raw active count regardless of
            upload status. */}
        <button
          type="button"
          className={styles.openPrompterBtn}
          onClick={() => setRecordingsModalOpen(true)}
          disabled={!takeResult && manualAttemptCount === 0}
          title={
            !takeResult && manualAttemptCount === 0
              ? "Record or add a video for this transcription first"
              : discardedAttemptCount > 0
              ? `${activeAttemptCount} active (${pendingUploadCount} pending upload), ${discardedAttemptCount} discarded -- open to review, restore, or upload`
              : allActiveUploaded
              ? `All ${activeAttemptCount} recording${activeAttemptCount === 1 ? "" : "s"} uploaded -- open to review or upload again`
              : `Review ${activeAttemptCount} recording${activeAttemptCount === 1 ? "" : "s"} (${pendingUploadCount} pending upload), mark Valid/Invalid, and upload`
          }
        >
          🎬 View Recordings
          {totalAttemptCount > 0
            ? allActiveUploaded
              ? ` (${activeAttemptCount} ✓)`
              : ` (${pendingUploadCount} pending)`
            : ""}
        </button>
        {countdownValue !== null && (
          <span className={styles.countdownLabel}>Starting in {countdownValue}…</span>
        )}
        {phase === "stopped" && agentRecordingState === "finalizing" && (
          <span className={styles.countdownLabel}>Downloading clips…</span>
        )}
      </div>
      </div>

      {/* Outside the blurred wrapper on purpose -- see disabledOverlayStyle
          above. Its own `disabled` prop still locks starting a NEW upload. */}
      <RecordingsModal
        open={recordingsModalOpen}
        onClose={() => setRecordingsModalOpen(false)}
        previews={mergedPreviews}
        cameraById={cameraById}
        jobId={jobId}
        sessionId={sessionId}
        transcriptionId={takeId}
        attemptAngles={mergedAttemptAngles}
        attemptCameras={attemptCameras}
        currentAssignments={assignments}
        attemptValidity={attemptValidity}
        onSetValidity={handleSetValidity}
        discardedAttempts={discardedAttempts}
        onSetDiscarded={handleSetDiscarded}
        forgottenClips={forgottenClips}
        onForgetClip={handleForgetClip}
        uploadedAttempts={uploadedAttempts}
        onAttemptUploaded={handleAttemptUploaded}
        onUploadComplete={onUploadComplete}
        disabled={disabled}
        postToPrompter={postToPrompter}
      />

      <div style={disabledOverlayStyle}>
      <section className={styles.prompterMonitor}>
        <div className={styles.prompterMonitorHeader}>
          <h3 className={styles.boxTitleSmall}>Teleprompter</h3>
          <div className={styles.prompterMonitorActions}>
            <button
              type="button"
              className={styles.mockRunBtn}
              onClick={handleMockRunToggle}
              disabled={!prompterConnected || disabled || phase === "countdown" || phase === "recording"}
              title={
                disabled
                  ? "This session is being ended"
                  : !prompterConnected
                  ? "Open the teleprompter window first"
                  : mockRunning
                  ? "Stop the mock run and reset to the top"
                  : "Preview the scroll without starting a take"
              }
            >
              {mockRunning ? "■ Stop mock run" : "▶ Mock run"}
            </button>
            <button type="button" className={styles.openPrompterBtn} onClick={handleOpenTeleprompter}>
              {prompterConnected ? "Reopen window" : "Open teleprompter window"}
            </button>
          </div>
        </div>

        <div className={styles.prompterControlsRow}>
          <div className={styles.prompterControlGroup}>
            <span className={styles.prompterControlLabel}>Font size</span>
            <div className={styles.fontStepper}>
              <button
                type="button"
                className={styles.fontStepBtn}
                onClick={handleFontDecrease}
                disabled={fontSize <= MIN_FONT_SIZE}
                aria-label="Decrease font size"
              >
                A−
              </button>
              <span className={styles.fontStepValue}>{fontSize}px</span>
              <button
                type="button"
                className={styles.fontStepBtn}
                onClick={handleFontIncrease}
                disabled={fontSize >= MAX_FONT_SIZE}
                aria-label="Increase font size"
              >
                A+
              </button>
            </div>
          </div>

          <div className={styles.prompterControlGroup}>
            <span className={styles.prompterControlLabel}>Scroll speed</span>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className={styles.speedSlider}
            />
            <span className={styles.fontStepValue}>{speed}px/s</span>
          </div>
        </div>

        {!prompterConnected ? (
          <p className={styles.assignHint}>
            Open the teleprompter window so it&apos;s visible to the presenter — it stays in sync
            automatically with record/stop, font size, speed, and whichever transcription is
            selected on the left.
          </p>
        ) : (
          <div className={styles.prompterProgress}>
            <span>
              Line {(scrollStatus?.lineIndex ?? 0) + 1} / {scrollStatus?.totalLines ?? "—"}
            </span>
            <div className={styles.prompterProgressBar}>
              <div
                className={styles.prompterProgressFill}
                style={{
                  width: scrollStatus
                    ? `${((scrollStatus.lineIndex + 1) / Math.max(scrollStatus.totalLines, 1)) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Hidden picker shared by every slot's "Add video" button. */}
      <input
        ref={importInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />
      </div>

      {disabled && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "2rem",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <span
            style={{
              background: "rgba(17,17,17,0.85)",
              color: "#fff",
              padding: "0.5rem 1.1rem",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            }}
            role="status"
          >
            ⏳ Ending session… recording is locked
          </span>
        </div>
      )}
    </div>
  );
}