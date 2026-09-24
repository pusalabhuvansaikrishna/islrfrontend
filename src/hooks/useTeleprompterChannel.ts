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
//
// UPDATE: added `videoPreview` messages so the Recordings modal (in
// RecorderPanel) can push a recorded/imported clip onto the
// teleprompter window in place of the scrolling script, and pull it
// back off again. See the teleprompter page for how "show"/"clear" are
// handled.
//
// FIX: `post()` used to call `channelRef.current?.postMessage(msg)`
// directly. `channelRef.current` is kept up to date by the effect below,
// but there's a real window -- an unmount, or in dev, React Strict
// Mode's mount -> cleanup -> remount cycle -- where some caller (e.g. an
// effect in a child component reacting to a prop change) fires `post()`
// after this hook's own cleanup has already called `channel.close()` on
// the channel `channelRef.current` still points at, but before a new
// channel has replaced it. `BroadcastChannel.postMessage` on a closed
// channel throws a synchronous `InvalidStateError`, which -- unlike a
// normal failed send -- crashes the render instead of just silently
// going nowhere. `post()` now tracks closed-ness explicitly and treats
// "channel is closed" as a no-op: there's no listener left to deliver
// to anyway, so dropping the message is the correct behavior, not an
// error.

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
  | { type: "windowReady" }
  // Sent FROM RecorderPanel's Recordings modal when the operator clicks
  // the "show on teleprompter" button on a clip. The teleprompter window
  // swaps its script view for a <video> of this clip until a "clear" (or
  // a "show" for a different clip) arrives. `url` is typically a blob:
  // URL created by RecorderPanel -- valid cross-window as long as the
  // tab that created it (the main session tab) stays open. `label` is
  // an optional short caption (e.g. the camera/angle name) shown over
  // the video.
  | { type: "videoPreview"; action: "show"; url: string; label?: string }
  | { type: "videoPreview"; action: "clear" };

function channelNameForSession(sessionId: string) {
  return `teleprompter-sync-${sessionId}`;
}

export function useTeleprompterChannel(
  sessionId: string,
  onMessage: (msg: PrompterMessage) => void
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  // True whenever channelRef.current is either null or a channel that's
  // already had .close() called on it. Set alongside channelRef itself
  // (not derived from it) so post() has a synchronous, authoritative
  // answer to "is it safe to postMessage right now" without needing to
  // probe the BroadcastChannel instance, which exposes no public
  // "closed" flag of its own.
  const closedRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const channel = new BroadcastChannel(channelNameForSession(sessionId));
    channelRef.current = channel;
    closedRef.current = false;
    channel.onmessage = (evt) => onMessageRef.current(evt.data as PrompterMessage);
    return () => {
      closedRef.current = true;
      channel.close();
    };
  }, [sessionId]);

  const post = useCallback((msg: PrompterMessage) => {
    if (closedRef.current || !channelRef.current) return;
    try {
      channelRef.current.postMessage(msg);
    } catch (err) {
      // Belt-and-suspenders on top of the closedRef check above: if a
      // postMessage still lands in the narrow window where the channel
      // was just closed but closedRef hasn't been observed yet (e.g.
      // React Strict Mode's mount/cleanup/remount churn in dev), treat
      // "posting to a closed channel" as a harmless no-op -- there's no
      // listener left to receive it -- rather than letting the
      // InvalidStateError crash the render. Anything else is rethrown.
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) {
        throw err;
      }
    }
  }, []);

  return post;
}