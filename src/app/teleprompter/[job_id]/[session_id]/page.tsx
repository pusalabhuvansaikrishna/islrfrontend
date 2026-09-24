"use client";

// Location: src/app/teleprompter/[job_id]/[session_id]/page.tsx
//
// UPDATE: handles `videoPreview` messages from the Recordings modal.
//   - "show":  a full-window <video> is laid over the script until a
//              "clear" (or another "show") arrives.
//   - "clear": the overlay is removed and the script is back exactly
//              where it was.
// The script area stays MOUNTED underneath (covered, not unmounted or
// display:none) so its scroll position and line refs survive the trip.
// A new countdown/recording phase also clears the preview, so the
// presenter never starts a take while looking at an old clip.
// Overlay styling lives in page.module.css (.videoPreview* classes).

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  useTeleprompterChannel,
  type PrompterMessage,
  type RecordingPhase,
} from "@/hooks/useTeleprompterChannel";

const DEFAULT_SCROLL_PIXELS_PER_SECOND = 28;
const DEFAULT_FONT_SIZE = 42;
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 72;

// The font-size slider on the session page (24-72px) is tuned against
// this window size (the popup's default open dimensions). When this
// window ends up a different size than that, the rendered font is scaled
// proportionally so the script still fills the space sensibly.
const REFERENCE_WIDTH = 900;
const REFERENCE_HEIGHT = 600;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type VideoPreview = { url: string; label?: string };

function TeleprompterPageInner() {
  const params = useParams<{ job_id: string; session_id: string }>();
  const sessionId = params.session_id;

  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [script, setScript] = useState<string>("Waiting for a script…");
  const [speed, setSpeed] = useState(DEFAULT_SCROLL_PIXELS_PER_SECOND);
  const [baseFontSize, setBaseFontSize] = useState(DEFAULT_FONT_SIZE);

  // The clip currently shown instead of the script (null = show script).
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // This window's own current viewport size. Updated on mount and on every
  // resize, which in most browsers also fires when the window is moved to
  // a screen with a different resolution/scale factor.
  const [windowSize, setWindowSize] = useState({ width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  const handleMessage = (msg: PrompterMessage) => {
    if (msg.type === "phase") {
      setPhase(msg.phase);
      if (msg.phase === "countdown") setCountdownValue(msg.countdownValue ?? null);
      if (msg.phase === "recording") setCountdownValue(null);
      // A new take is starting -- get the old clip out of the way.
      if (msg.phase === "countdown" || msg.phase === "recording") {
        setVideoPreview(null);
        setVideoError(null);
      }
      // "stopped" intentionally does NOT reset scroll position -- it just
      // stops the animation loop below, freezing wherever it was. Use the
      // explicit "jumpToStart" control message to actually reset.
    } else if (msg.type === "script") {
      setScript(msg.text);
    } else if (msg.type === "control") {
      if (msg.action === "setSpeed" && msg.speed) setSpeed(msg.speed);
      if (msg.action === "setFontSize" && msg.fontSize) setBaseFontSize(msg.fontSize);
      if (msg.action === "jumpToStart" && scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        // Tell the parent immediately so its mini preview snaps back to
        // the top too.
        post({
          type: "scrollStatus",
          lineIndex: 0,
          totalLines: scriptLinesRef.current.length,
          scrollFraction: 0,
        });
      }
    } else if (msg.type === "videoPreview") {
      if (msg.action === "show") {
        setVideoError(null);
        setVideoPreview({ url: msg.url, label: msg.label });
      } else {
        setVideoPreview(null);
        setVideoError(null);
      }
    }
  };

  const post = useTeleprompterChannel(sessionId, handleMessage);

  // Announce we're up and ready -- the session page responds with the
  // currently selected transcription's script, font size, and speed.
  useEffect(() => {
    post({ type: "windowReady" });
  }, [post]);

  // Track this window's real size.
  useEffect(() => {
    function updateSize() {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const scaleFactor = clamp(
    Math.min(windowSize.width / REFERENCE_WIDTH, windowSize.height / REFERENCE_HEIGHT),
    MIN_SCALE,
    MAX_SCALE
  );
  const effectiveFontSize = clamp(
    baseFontSize * scaleFactor,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE * MAX_SCALE
  );

  // Tell the session page our real size + the font size we're actually
  // rendering at, so its live monitor can mirror this exactly.
  useEffect(() => {
    post({
      type: "windowInfo",
      innerWidth: windowSize.width,
      innerHeight: windowSize.height,
      effectiveFontSize,
    });
  }, [windowSize, effectiveFontSize, post]);

  // Start playback whenever a new clip is shown. Browsers can block
  // autoplay-with-sound in a window the user hasn't clicked in yet, so on
  // failure fall back to muted autoplay (the controls let them unmute).
  useEffect(() => {
    const el = videoRef.current;
    if (!videoPreview || !el) return;
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
  }, [videoPreview]);

  const scriptLines = script.split("\n");
  // Kept in a ref too so the "jumpToStart" handler above always reads the
  // latest value without being a dependency of anything.
  const scriptLinesRef = useRef(scriptLines);
  scriptLinesRef.current = scriptLines;

  // Finds the topmost line already scrolled to (or past) the top of the
  // viewport, using each line's real offsetTop rather than assuming
  // uniform line height.
  const getCurrentLineIndex = useCallback((scrollTop: number) => {
    const lines = lineRefs.current;
    let lo = 0;
    let hi = lines.length - 1;
    let result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = lines[mid];
      if (!el) break;
      if (el.offsetTop <= scrollTop) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }, []);

  // Auto-scroll only while phase === "recording"; paused (not reset) the
  // instant it isn't.
  useEffect(() => {
    if (phase !== "recording") {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
      return;
    }

    function step(timestamp: number) {
      if (lastFrameTimeRef.current === null) lastFrameTimeRef.current = timestamp;
      const deltaSeconds = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      const el = scrollRef.current;
      if (el) {
        el.scrollTop += speed * deltaSeconds;

        const lineIndex = getCurrentLineIndex(el.scrollTop);
        const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
        const scrollFraction = clamp(el.scrollTop / maxScroll, 0, 1);

        // Report every frame so the session page's mini preview scrolls
        // smoothly rather than snapping at line boundaries.
        post({
          type: "scrollStatus",
          lineIndex,
          totalLines: scriptLinesRef.current.length,
          scrollFraction,
        });
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, speed, post, getCurrentLineIndex]);

  return (
    <div className={styles.page}>
      {countdownValue !== null && (
        <div className={styles.countdownOverlay}>
          <span className={styles.countdownNumber}>{countdownValue}</span>
        </div>
      )}

      <div ref={scrollRef} className={styles.scrollArea}>
        <div className={styles.scriptText} style={{ fontSize: `${effectiveFontSize}px` }}>
          {scriptLines.map((line, i) => (
            <div
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className={styles.scriptLine}
            >
              {line || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.statusBar}>{phase}</div>

      {/* Recorded-clip overlay. Covers the script instead of replacing it,
          so the script's scroll position is intact when it's cleared. */}
      {videoPreview && (
        <div className={styles.videoPreviewWrap}>
          <video
            key={videoPreview.url}
            ref={videoRef}
            src={videoPreview.url}
            className={styles.videoPreviewPlayer}
            controls
            autoPlay
            playsInline
            onError={() => setVideoError("Couldn't load this video in the teleprompter window.")}
          />
          {videoPreview.label && (
            <span className={styles.videoPreviewLabel}>📺 {videoPreview.label}</span>
          )}
          {videoError && <span className={styles.videoPreviewError}>⚠ {videoError}</span>}
        </div>
      )}
    </div>
  );
}

export default function TeleprompterPage() {
  return <TeleprompterPageInner />;
}