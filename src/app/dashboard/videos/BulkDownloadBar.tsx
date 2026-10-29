"use client";

import { useState } from "react";
import { downloadVideosZip } from "@/lib/api";
import { MAX_BULK_VIDEOS, type FilterSelection } from "./useVideoSelection";
import styles from "./BulkDownload.module.css";

export type BulkMessage = { kind: "ok" | "error"; text: string };

type Props = {
  /** Videos ticked one by one. */
  videoIds: string[];
  /** Set when "Select all N videos in these results" is on; takes over from videoIds. */
  matching: FilterSelection | null;
  onClear: () => void;
  /** Raise an annotation task for every selected video. */
  onSubmitForAnnotation: () => void;
  /** True while the bulk submit request is in flight. */
  submitBusy: boolean;
  /** Result of the last bulk submit; stays visible even after the selection is cleared. */
  message: BulkMessage | null;
  onDismissMessage: () => void;
};

export default function BulkDownloadBar({
  videoIds,
  matching,
  onClear,
  onSubmitForAnnotation,
  submitBusy,
  message,
  onDismissMessage,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = matching ? matching.count : videoIds.length;
  const hasSelection = count > 0;

  // Nothing selected and nothing to report: hide the bar.
  if (!hasSelection && !message) return null;

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      await downloadVideosZip(matching ? { filters: matching.filters } : { videoIds });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      // The browser takes over once the link is clicked; re-enable shortly after.
      setTimeout(() => setBusy(false), 1500);
    }
  }

  const atLimit = !matching && videoIds.length >= MAX_BULK_VIDEOS;
  const anyBusy = busy || submitBusy;

  return (
    <div className={styles.bar} role="region" aria-label="Bulk actions">
      <div className={styles.barInfo}>
        {hasSelection && (
          <span className={styles.barCount}>
            {count} video{count === 1 ? "" : "s"} selected{matching ? " (all results)" : ""}
          </span>
        )}
        {hasSelection && atLimit && (
          <span className={styles.barNote}>
            Max {MAX_BULK_VIDEOS} ticked one by one. Use “Select all” for more.
          </span>
        )}
        {error && <span className={styles.barError}>{error}</span>}
        {message && (
          <span className={message.kind === "error" ? styles.barError : styles.barMessageOk}>{message.text}</span>
        )}
      </div>

      <div className={styles.barActions}>
        {hasSelection ? (
          <>
            <button type="button" className={styles.barClear} onClick={onClear} disabled={anyBusy}>
              Clear
            </button>
            <button
              type="button"
              className={styles.barSubmit}
              onClick={onSubmitForAnnotation}
              disabled={anyBusy}
              title="Raise an annotation task for every selected video"
            >
              {submitBusy ? <span className={styles.barSpinner} aria-hidden="true" /> : null}
              {submitBusy ? "Submitting…" : "Submit for annotation"}
            </button>
            <button type="button" className={styles.barDownload} onClick={handleDownload} disabled={anyBusy}>
              {busy ? <span className={styles.barSpinner} aria-hidden="true" /> : null}
              {busy ? "Preparing…" : "Download ZIP"}
            </button>
          </>
        ) : (
          <button type="button" className={styles.barDismiss} onClick={onDismissMessage} aria-label="Dismiss message">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}