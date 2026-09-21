"use client";

// Location: src/components/MjpegStream.tsx
// Ported verbatim from the recorder project — no changes needed. It's
// self-contained (no BASE_URL / project-specific imports), just reads
// whatever `src` it's given.

import { useEffect, useRef, useState } from "react";

interface MjpegStreamProps {
  src: string;
  alt: string;
  className?: string;
  /**
   * If no new frame arrives within this many ms, treat the connection as
   * dead and force a reconnect -- even though fetch() itself may not have
   * errored or closed. This is what catches a stream that's stalled
   * silently (e.g. the server-side pipeline hung) rather than one that
   * cleanly ended.
   */
  staleTimeoutMs?: number;
}

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;

/**
 * Renders a multipart/x-mixed-replace (MJPEG) HTTP stream.
 *
 * We deliberately do NOT use a plain `<img src="...">` pointed at the
 * stream URL, which is the "classic" way to show MJPEG in a browser.
 * Firefox handles that reliably; Chrome's support for
 * multipart/x-mixed-replace inside <img> has long-standing quirks where
 * the image can silently stop updating -- frozen on whatever the last
 * frame was -- with no error and no event fired. There is no way to
 * detect or recover from that from outside the <img> element.
 *
 * Instead, this component fetches the stream itself, reads the raw
 * bytes, extracts each JPEG frame by its SOI (0xFFD8) / EOI (0xFFD9)
 * markers, and swaps each one into a plain <img> via a Blob URL. Because
 * we're the ones reading the stream, we can:
 *   - notice a stalled connection (no new frame for `staleTimeoutMs`) and
 *     force a reconnect even if fetch() itself hasn't complained, and
 *   - notice the connection actually closing/erroring and reconnect with
 *     backoff, instead of freezing forever.
 */
export default function MjpegStream({ src, alt, className, staleTimeoutMs = 5000 }: MjpegStreamProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const armWatchdog = () => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        // No frame in `staleTimeoutMs` -- the connection is presumed
        // dead even though fetch() hasn't told us so. Aborting here
        // drives the same reconnect path as a genuine network error.
        abortController?.abort();
      }, staleTimeoutMs);
    };

    const publishFrame = (bytes: Uint8Array) => {
      const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const prev = currentUrlRef.current;
      currentUrlRef.current = url;
      setFrameUrl(url);
      // Revoke the previous frame's URL only after the new one is set,
      // so we never briefly reference a URL that's already been freed.
      if (prev) URL.revokeObjectURL(prev);
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const attempt = reconnectAttempt++;
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
      reconnectTimer = setTimeout(connect, delay);
    };

    async function connect() {
      if (cancelled) return;
      abortController = new AbortController();

      try {
        const res = await fetch(src, { signal: abortController.signal });
        if (!res.ok || !res.body) {
          throw new Error(`Stream request failed: ${res.status}`);
        }
        reconnectAttempt = 0; // reset backoff once we've connected successfully

        const reader = res.body.getReader();
        let buffer = new Uint8Array(0);

        const appendChunk = (chunk: Uint8Array) => {
          const next = new Uint8Array(buffer.length + chunk.length);
          next.set(buffer, 0);
          next.set(chunk, buffer.length);
          buffer = next;
        };

        // Scans for a full JPEG frame (SOI...EOI) in `buffer`. Scanning
        // for the JPEG markers directly, rather than parsing the
        // multipart boundary/headers by hand, is more robust to minor
        // formatting differences across ffmpeg builds and doesn't
        // depend on a Content-Length header being present or accurate.
        const extractFrame = (): Uint8Array | null => {
          const soi = indexOfMarker(buffer, 0xff, 0xd8, 0);
          if (soi === -1) {
            // No frame start yet -- drop any leading multipart boundary/
            // header bytes so the buffer doesn't grow unboundedly while
            // waiting for the first frame.
            if (buffer.length > 4096) buffer = buffer.slice(buffer.length - 4096);
            return null;
          }
          const eoi = indexOfMarker(buffer, 0xff, 0xd9, soi + 2);
          if (eoi === -1) return null;
          const frame = buffer.slice(soi, eoi + 2);
          buffer = buffer.slice(eoi + 2);
          return frame;
        };

        armWatchdog();

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            appendChunk(value);
            let frame = extractFrame();
            while (frame) {
              publishFrame(frame);
              armWatchdog();
              frame = extractFrame();
            }
            // Defensive cap: if we somehow never find a valid JPEG
            // marker (e.g. the server sent something unexpected), don't
            // let the buffer grow forever.
            if (buffer.length > 5_000_000) buffer = new Uint8Array(0);
          }
        }
        // Reader loop ended cleanly (server closed the response) --
        // still treat this as "connection lost" so we reconnect.
        throw new Error("Stream ended");
      } catch {
        // Covers real network errors, the watchdog-triggered abort, and
        // the "stream ended" case above -- all handled the same way.
      } finally {
        clearWatchdog();
      }

      scheduleReconnect();
    }

    connect();

    return () => {
      cancelled = true;
      abortController?.abort();
      clearWatchdog();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, staleTimeoutMs]);

  if (!frameUrl) return null;

  // eslint-disable-next-line @next/next/no-img-element -- this is a Blob
  // URL we generate ourselves for each incoming frame; next/image has
  // nothing useful to optimize here and would fight the constant src churn.
  return <img src={frameUrl} alt={alt} className={className} />;
}

function indexOfMarker(buf: Uint8Array, b0: number, b1: number, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === b0 && buf[i + 1] === b1) return i;
  }
  return -1;
}