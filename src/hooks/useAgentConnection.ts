"use client";

// Location: src/hooks/useAgentConnection.ts
// Ported verbatim from the recorder project — no changes needed. It's
// self-contained (no BASE_URL / project-specific imports), just talks to
// the local agent over WebSocket + HTTP.

import { useCallback, useEffect, useRef, useState } from "react";

// TODO: make configurable (e.g. if the agent ever needs a non-default
// port, or exposes a discovery endpoint). Hardcoded is fine for now
// since it's just talking to localhost.
const AGENT_WS_URL = "ws://localhost:8787/ws";

// Base HTTP URL for the same agent (used for the live-preview <img> src,
// which can't go over the WebSocket). Same host/port as AGENT_WS_URL,
// just http(s) instead of ws(s).
export const AGENT_HTTP_URL = "http://localhost:8787";

// Flip on with NEXT_PUBLIC_MOCK_AGENT=true while the real agent doesn't
// exist yet, so the rest of the UI (assignment, grid, recording flow)
// can be built and demoed without hardware.
const USE_MOCK = process.env.NEXT_PUBLIC_MOCK_AGENT === "true";

// Hardware identity of a camera, as reported by the agent. Field names are
// snake_case on purpose: they're sent to the backend as-is.
export interface CameraMetadata {
  make: string;
  model: string | null;
  serial_number: string | null;
  firmware_version: string | null;
}

export interface DetectedCamera {
  id: string; // stable serial/identifier reported by the agent
  name: string; // display name, e.g. "GoPro HERO12 (Front-ish)"
  thumbnailUrl?: string; // still/placeholder frame, if agent provides one
  metadata?: CameraMetadata; // hardware identity, if the agent provides it
}

export type AgentStatus = "connecting" | "connected" | "disconnected" | "error";

// Mirrors the agent's previewState WS event. "starting": command sent,
// ffmpeg not producing frames yet. "ready": frames flowing, safe to
// point an <img> at /stream/<cameraId>. "stopped": no active preview.
export interface PreviewState {
  cameraId: string;
  state: "starting" | "ready" | "stopped";
}

// Mirrors the agent's recordingState WS event -- the actual, confirmed
// state of the recording state machine on the agent side (as opposed to
// whatever the UI is optimistically showing while a command is in flight).
export type AgentRecordingState = "idle" | "recording" | "finalizing";

// One camera's segment result from a completed take, as reported in the
// agent's recordingComplete event.
export interface RecordingSegmentResult {
  index: number;
  filename: string;
  url: string | null; // null if this segment failed to download
  error: string | null;
}

export interface RecordingCompleteResult {
  takeId: string;
  // Which recording attempt within the take this snapshot's "latest"
  // event was for. Not required to interpret `previews` (every clip
  // already carries its own attempt index -- see RecordingSegmentResult
  // below), but callers use this to know which attempt just completed,
  // e.g. to correlate it with camera->angle assignments captured at the
  // moment recording started (assignments can change between attempts).
  attemptIndex?: number;
  previews: Record<string, RecordingSegmentResult[]>; // cameraId -> segments
}

interface AgentState {
  status: AgentStatus;
  cameras: DetectedCamera[];
  previewState: PreviewState | null;
  recordingState: AgentRecordingState;
  lastRecordingResult: RecordingCompleteResult | null;
  lastError: string | null;
}

const MOCK_CAMERAS: DetectedCamera[] = [
  {
    id: "mock-cam-1",
    name: "GoPro HERO12 — A1B2",
    metadata: { make: "GoPro", model: "HERO12 Black", serial_number: "MOCK0000A1B2", firmware_version: "H23.01.02.32.00" },
  },
  {
    id: "mock-cam-2",
    name: "GoPro HERO12 — C3D4",
    metadata: { make: "GoPro", model: "HERO12 Black", serial_number: "MOCK0000C3D4", firmware_version: "H23.01.02.32.00" },
  },
  {
    id: "mock-cam-3",
    name: "GoPro HERO11 — E5F6",
    metadata: { make: "GoPro", model: "HERO11 Black", serial_number: "MOCK0000E5F6", firmware_version: "H22.01.02.32.00" },
  },
];

export function useAgentConnection() {
  const [state, setState] = useState<AgentState>({
    status: USE_MOCK ? "connected" : "connecting",
    cameras: USE_MOCK ? MOCK_CAMERAS : [],
    previewState: null,
    recordingState: "idle",
    lastRecordingResult: null,
    lastError: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(AGENT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "connected" }));
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "disconnected" }));
        // Agent may not be running yet, or the user just launched it —
        // keep retrying rather than giving up.
        retryTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "error" }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === "cameras" && Array.isArray(msg.cameras)) {
            setState((s) => ({ ...s, cameras: msg.cameras }));
          } else if (msg?.type === "previewState" && msg.cameraId && msg.state) {
            setState((s) => ({
              ...s,
              previewState:
                msg.state === "stopped" ? null : { cameraId: msg.cameraId, state: msg.state },
            }));
          } else if (msg?.type === "recordingState" && typeof msg.state === "string") {
            // The agent's actual, confirmed recording state -- e.g. after
            // it flips back to "idle" following a take, or moves through
            // "finalizing" while downloading clips. This is what the UI
            // should trust over any locally-optimistic phase tracking.
            setState((s) => ({ ...s, recordingState: msg.state as AgentRecordingState }));
          } else if (msg?.type === "recordingComplete" && typeof msg.takeId === "string") {
            setState((s) => ({
              ...s,
              lastRecordingResult: {
                takeId: msg.takeId,
                attemptIndex: typeof msg.attemptIndex === "number" ? msg.attemptIndex : undefined,
                previews: msg.previews ?? {},
              },
            }));
          } else if (msg?.type === "error" && typeof msg.message === "string") {
            setState((s) => ({ ...s, lastError: msg.message }));
          }
        } catch {
          // Ignore malformed messages rather than crashing the connection.
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  // Guards against the browser's back/forward cache (bfcache). When a
  // page is restored from bfcache -- closing and reopening the tab,
  // navigating back, etc. -- the browser can bring back the ENTIRE page,
  // including every bit of in-memory React state, from a frozen
  // snapshot, without re-running any of this hook's setup. The
  // WebSocket connection in that snapshot is dead (browsers close
  // sockets before freezing a page for bfcache), but state like
  // `cameras` and `lastRecordingResult` is still sitting there exactly
  // as it was, indistinguishable from a live connection -- e.g. showing
  // "View Recordings (3)" and stale camera state well after the agent
  // (or the whole app) was restarted, because the tab itself was never
  // actually re-executed from scratch.
  //
  // `pageshow` fires on every page load, including bfcache restores,
  // and `event.persisted` is true only for the latter. A real reload is
  // the only fully reliable fix here: it re-runs this hook (and
  // everything else) from a clean slate rather than trying to patch up
  // individual pieces of possibly-stale state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const sendCommand = useCallback((command: Record<string, unknown>) => {
    if (USE_MOCK) {
      console.info("[mock agent] command:", command);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  // takeId is optional to keep the call site flexible, but callers should
  // always pass the real take id -- omitting it means the agent falls
  // back to a random uuid, and downloaded clips land under a folder name
  // that doesn't match the take the rest of the app thinks it recorded.
  //
  // cameraIds is likewise optional but, in practice, callers should
  // ALWAYS pass it: it's the list of camera ids that should actually be
  // armed and recorded (e.g. only the cameras currently assigned to an
  // angle), as opposed to every camera the agent happens to be connected
  // to. Omitting it falls back to "record everything connected" on the
  // agent side -- kept for backwards compatibility, not as the intended
  // normal path.
  const startRecording = useCallback(
    (takeId?: string, cameraIds?: string[]) =>
      sendCommand({
        type: "startRecording",
        ...(takeId ? { takeId } : {}),
        ...(cameraIds ? { cameraIds } : {}),
      }),
    [sendCommand]
  );
  const stopRecording = useCallback(
    () => sendCommand({ type: "stopRecording" }),
    [sendCommand]
  );
  const startPreview = useCallback(
    (cameraId: string) => sendCommand({ type: "startPreview", cameraId }),
    [sendCommand]
  );
  const stopPreview = useCallback(
    (cameraId: string) => sendCommand({ type: "stopPreview", cameraId }),
    [sendCommand]
  );

  // Lets callers clear a shown error once they've displayed/handled it,
  // instead of it lingering in state forever after the first failure.
  const clearError = useCallback(() => {
    setState((s) => ({ ...s, lastError: null }));
  }, []);

  return {
    ...state,
    sendCommand,
    startRecording,
    stopRecording,
    startPreview,
    stopPreview,
    clearError,
  };
}