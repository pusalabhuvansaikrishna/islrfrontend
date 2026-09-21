"use client";

// Location: src/hooks/useTeleprompterChannel.ts
//
// Ported from the recorder project's hook of the same name, unchanged
// except for what the channel is keyed by: the original kept one
// channel per *take* (a fixed id from the URL, one per page load). Here
// a single session page can walk through several transcriptions in a
// row without the operator reopening the popup, so the channel is keyed
// by *session id* instead -- stable for as long as the page (and any
// popup opened from it) is open, regardless of which transcription is
// currently selected. Which transcription's text is showing is just
// another "script" message on that same channel (see RecorderPanel).

import { useCallback, useEffect, useRef } from "react";

export type RecordingPhase = "idle" | "countdown" | "recording" | "stopped";

// Everything that can cross between the main tab and the teleprompter
// window. Kept as a single discriminated union so both sides share one
// source of truth for the wire format.
export type PrompterMessage =
  | { type: "phase"; phase: RecordingPhase; countdownValue?: number }
  | { type: "script"; text: string }
  | { type: "control"; action: "setSpeed"; speed: number }
  | { type: "control"; action: "setFontSize"; fontSize: number }
  | { type: "control"; action: "jumpToStart" }
  // Sent FROM the teleprompter window so the main tab's monitor panel
  // can mirror what the presenter is currently seeing. `scrollFraction`
  // (0 = top, 1 = fully scrolled) is sent on every animation frame while
  // scrolling, in addition to `lineIndex` — the fraction is what lets the
  // parent's mini preview scroll smoothly and continuously in lockstep,
  // rather than only snapping forward whenever the active line changes.
  | { type: "scrollStatus"; lineIndex: number; totalLines: number; scrollFraction: number }
  // Sent FROM the teleprompter window whenever its own size or effective
  // font size changes (e.g. moved to another display), so the main tab's
  // mini preview can mirror it proportionally instead of guessing.
  | { type: "windowInfo"; innerWidth: number; innerHeight: number; effectiveFontSize: number }
  | { type: "windowReady" };

function channelNameForSession(sessionId: string) {
  return `teleprompter-sync-${sessionId}`;
}

export function useTeleprompterChannel(
  sessionId: string,
  onMessage: (msg: PrompterMessage) => void
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const channel = new BroadcastChannel(channelNameForSession(sessionId));
    channelRef.current = channel;
    channel.onmessage = (evt) => onMessageRef.current(evt.data as PrompterMessage);
    return () => channel.close();
  }, [sessionId]);

  const post = useCallback((msg: PrompterMessage) => {
    channelRef.current?.postMessage(msg);
  }, []);

  return post;
}