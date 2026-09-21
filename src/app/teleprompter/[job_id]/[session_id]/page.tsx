"use client";

// Location: src/app/teleprompter/[job_id]/[session_id]/page.tsx
//
// Full scrolling teleprompter, upgraded from the earlier simple
// "show selected transcription" version to match the original recorder
// project's popup exactly: phase-synced with record/stop, adjustable
// font size + scroll speed (mirrored from RecorderPanel), and a
// self-reported windowInfo so the session page's mini preview can mirror
// this window's real size/font proportionally.
//
// Still lives OUTSIDE src/app/dashboard/ as a top-level route, so it
// doesn't inherit dashboard/layout.tsx's sidebar + header — see the
// earlier version's comment for the full reasoning, which still applies.
//
// Where this differs from the original recorder's teleprompter page:
// the "script" text it receives is pushed by RecorderPanel from
// whichever transcription is currently selected in the session sidebar
// (transcription.text, already loaded — no separate script fetch here
// or in the parent), rather than being fetched by this page itself.

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
// window ends up a different size than that — e.g. dragged to another
// screen and resized/maximized there — the rendered font is scaled
// proportionally so the script still fills the space sensibly.
const REFERENCE_WIDTH = 900;
const REFERENCE_HEIGHT = 600;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TeleprompterPageInner() {
  const params = useParams<{ job_id: string; session_id: string }>();
  const sessionId = params.session_id;

  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [script, setScript] = useState<string>("Waiting for a script…");
  const [speed, setSpeed] = useState(DEFAULT_SCROLL_PIXELS_PER_SECOND);
  const [baseFontSize, setBaseFontSize] = useState(DEFAULT_FONT_SIZE);

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
      // "stopped" intentionally does NOT reset scroll position — it just
      // stops the animation loop below, freezing wherever it was. Use the
      // explicit "jumpToStart" control message below to actually reset.
    } else if (msg.type === "script") {
      setScript(msg.text);
    } else if (msg.type === "control") {
      if (msg.action === "setSpeed" && msg.speed) setSpeed(msg.speed);
      if (msg.action === "setFontSize" && msg.fontSize) setBaseFontSize(msg.fontSize);
      if (msg.action === "jumpToStart" && scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        // Tell the parent immediately so its mini preview snaps back to
        // the top too, instead of waiting for the next animation frame
        // (which won't come until phase is "recording" again).
        post({ type: "scrollStatus", lineIndex: 0, totalLines: scriptLinesRef.current.length, scrollFraction: 0 });
      }
    }
  };

  const post = useTeleprompterChannel(sessionId, handleMessage);

  // Announce we're up and ready — the session page responds with the
  // currently selected transcription's script, font size, and speed
  // (see RecorderPanel).
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

  // How far this window's actual size is from the reference size the font
  // slider was designed around.
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
  // rendering at, so its live monitor can mirror this exactly instead of
  // guessing with a fixed scale-down.
  useEffect(() => {
    post({
      type: "windowInfo",
      innerWidth: windowSize.width,
      innerHeight: windowSize.height,
      effectiveFontSize,
    });
  }, [windowSize, effectiveFontSize, post]);

  const scriptLines = script.split("\n");
  // Kept in a ref too so the "jumpToStart" handler above (defined before
  // scriptLines is computed each render) always reads the latest value
  // without needing to be redeclared as a dependency of anything.
  const scriptLinesRef = useRef(scriptLines);
  scriptLinesRef.current = scriptLines;

  // Finds the topmost line already scrolled to (or past) the top of the
  // viewport, using each line's *real* offsetTop rather than assuming
  // uniform line height. This stays accurate regardless of how the text
  // wraps — including right after a resize changes the wrap points, which
  // is exactly when the old average-height math used to fall apart.
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
  // instant it isn't. Re-reads `speed` on every render via the effect's
  // dependency array, so changing the slider on the session page takes
  // effect immediately without restarting from the top.
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

        // Report on every frame (not just when the line index changes) so
        // mirrors like the session page's mini preview can scroll smoothly
        // and continuously in real time, rather than snapping forward only
        // at line boundaries.
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
    </div>
  );
}

export default function TeleprompterPage() {
  return <TeleprompterPageInner />;
}