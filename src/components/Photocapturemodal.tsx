"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./PhotoCaptureModal.module.css";

// The GoPro agent (goproagent/agent_server.py) is a separate local
// process -- it runs on whatever machine has the cameras plugged in,
// not as part of the main backend. Override via
// NEXT_PUBLIC_GOPRO_AGENT_URL if that's ever somewhere other than
// localhost:8787 (e.g. the recording station is a different machine
// than the one running the browser).
const AGENT_URL = process.env.NEXT_PUBLIC_GOPRO_AGENT_URL ?? "http://localhost:8787";

// HERO8 capture over the legacy API is slow: mode switch, shutter,
// media-list poll, download. Give it room before giving up.
const CAPTURE_TIMEOUT_MS = 60_000;

interface AgentCamera {
  id: string;
  name: string;
  metadata: {
    make: string;
    model: string | null;
    serial_number: string | null;
    firmware_version: string | null;
  };
}

type AgentEvent =
  | { type: "cameras"; cameras: AgentCamera[] }
  | { type: "previewState"; cameraId: string; state: "starting" | "ready" | "stopped" }
  | { type: "recordingState"; state: string }
  | { type: "error"; message: string };

interface PhotoCaptureModalProps {
  onClose: () => void;
  /** Called with the captured photo as a real File, ready to drop into
   * the same form-data flow as a manually-picked file. */
  onCaptured: (file: File) => void;
}

/**
 * Turns a thrown fetch error into something the user can act on.
 * A browser blocks a request (CORS, agent down, connection refused) by
 * throwing a bare TypeError("Failed to fetch") with no status and no
 * detail, which is useless on screen.
 */
function describeCaptureError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "The camera took too long to respond. Check that it's powered on and try again.";
  }
  if (err instanceof TypeError) {
    return "Couldn't reach the GoPro agent to take the photo. Check that it's running and allows requests from this page (see the browser console for a CORS error).";
  }
  return err instanceof Error ? err.message : "Couldn't capture the photo.";
}

export default function PhotoCaptureModal({ onClose, onCaptured }: PhotoCaptureModalProps) {
  const wsRef = useRef<WebSocket | null>(null);
  // Mirrors `selectedCamera` state for use inside the WS onmessage
  // handler and cleanup functions, which otherwise close over a stale
  // value from whenever the effect first ran.
  const selectedCameraRef = useRef<string | null>(null);

  const [cameras, setCameras] = useState<AgentCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "starting" | "ready">("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    selectedCameraRef.current = selectedCamera;
  }, [selectedCamera]);

  // Open the agent's WebSocket control channel once, for the lifetime
  // of this modal. Used only to get the camera list and to start/stop
  // the live preview -- capture itself is a plain REST POST (see
  // handleCapture).
  useEffect(() => {
    const wsUrl = AGENT_URL.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnectionError(null);
    ws.onerror = () => setConnectionError("Could not reach the GoPro agent. Is it running?");
    ws.onclose = () => setConnectionError((prev) => prev ?? "Lost connection to the GoPro agent.");

    ws.onmessage = (event) => {
      let data: AgentEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "cameras") {
        setCameras(data.cameras);
        // Auto-pick the first camera once the list arrives, if nothing
        // is selected yet -- saves a click in the common one-camera case.
        setSelectedCamera((prev) => prev ?? data.cameras[0]?.id ?? null);
      } else if (data.type === "previewState") {
        if (data.cameraId !== selectedCameraRef.current) return;
        setPreviewState(data.state === "stopped" ? "idle" : data.state);
      } else if (data.type === "error") {
        setCaptureError(data.message);
      }
    };

    return () => {
      // Best-effort: stop whatever preview is running before the socket
      // closes, so the camera isn't left streaming to nobody.
      const cam = selectedCameraRef.current;
      if (cam && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stopPreview", cameraId: cam }));
      }
      ws.close();
    };
    // Intentionally run once per modal open -- selectedCamera changes
    // are handled by the separate effect below, not by re-running this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever the selected camera changes, stop any other camera's
  // preview and start this one. The agent only supports one active
  // preview at a time (see camera_manager.py's module docstring), so
  // switching cameras always means a stop-then-start, never both at once.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !selectedCamera) return;

    setPreviewState("starting");
    setCaptureError(null);

    const startThisPreview = () =>
      ws.send(JSON.stringify({ type: "startPreview", cameraId: selectedCamera }));

    if (ws.readyState === WebSocket.OPEN) {
      startThisPreview();
    } else {
      ws.addEventListener("open", startThisPreview, { once: true });
    }

    return () => {
      ws.removeEventListener("open", startThisPreview);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stopPreview", cameraId: selectedCamera }));
      }
    };
  }, [selectedCamera]);

  const handleCapture = useCallback(async () => {
    if (!selectedCamera) return;
    setCapturing(true);
    setCaptureError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

    try {
      // No destDir sent -- the agent saves into its own staging folder
      // and hands back a /photos/<file> URL we can fetch (see
      // agent_server.py's capture_photo_handler). We only need the
      // bytes here; where the photo ultimately lives long-term is
      // decided by the backend once the signer form is submitted.
      const res = await fetch(`${AGENT_URL}/cameras/${encodeURIComponent(selectedCamera)}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Capture failed (${res.status})`);
      }
      if (!body?.url) {
        throw new Error("Agent captured the photo but didn't return a retrievable URL.");
      }

      const imgRes = await fetch(`${AGENT_URL}${body.url}`, { signal: controller.signal });
      if (!imgRes.ok) throw new Error("Captured photo could not be downloaded from the agent.");
      const blob = await imgRes.blob();
      const file = new File([blob], body.filename ?? "signer-photo.jpg", {
        type: blob.type || "image/jpeg",
      });

      onCaptured(file);
      onClose();
    } catch (err) {
      setCaptureError(describeCaptureError(err));
    } finally {
      clearTimeout(timeout);
      setCapturing(false);
    }
  }, [selectedCamera, onCaptured, onClose]);

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !capturing) onClose();
  }

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="captureModalTitle">
        <div className={styles.modalHeader}>
          <h3 id="captureModalTitle" className={styles.modalTitle}>
            Capture signer photo
          </h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={capturing}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {connectionError && <p className={styles.errorText}>{connectionError}</p>}

          {!connectionError && cameras.length === 0 && (
            <p className={styles.hintText}>Looking for connected GoPro cameras…</p>
          )}

          {cameras.length > 0 && (
            <div className={styles.cameraPicker}>
              {cameras.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  className={`${styles.cameraChip} ${
                    cam.id === selectedCamera ? styles.cameraChipActive : ""
                  }`}
                  onClick={() => setSelectedCamera(cam.id)}
                  disabled={capturing}
                >
                  {cam.name}
                </button>
              ))}
            </div>
          )}

          <div className={styles.feedFrame}>
            {selectedCamera && previewState === "ready" ? (
              // The agent's /stream/<camId> is a standard MJPEG
              // multipart/x-mixed-replace stream -- a plain <img> tag
              // renders it as continuously-updating live video, no
              // extra libraries needed. `key` forces a fresh <img>
              // (and thus a fresh connection) whenever the camera
              // changes, instead of reusing one pointed at a stale URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={selectedCamera}
                src={`${AGENT_URL}/stream/${selectedCamera}`}
                alt="Live camera feed"
                className={styles.feedImg}
              />
            ) : (
              <div className={styles.feedPlaceholder}>
                {selectedCamera ? "Starting preview…" : "Select a camera to see its feed"}
              </div>
            )}
          </div>

          {captureError && <p className={styles.errorText}>{captureError}</p>}
        </div>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={capturing}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.captureBtn}
            onClick={handleCapture}
            disabled={!selectedCamera || previewState !== "ready" || capturing}
          >
            {capturing ? "Capturing…" : "Capture photo"}
          </button>
        </div>
      </div>
    </div>
  );
}