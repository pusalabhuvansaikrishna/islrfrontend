"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getJob,
  getJobSession,
  listSignerPendingTranscriptions,
  listSessionTranscriptions,
  endJobSession,
  getVideoFileUrl,
  ApiError,
  type Job,
  type SessionDetail,
  type TranscriptionRow,
  type SessionWorkedTranscription,
} from "@/lib/api"; // TODO: adjust path if your api module lives elsewhere
import styles from "./page.module.css";
import RecorderPanel from "./RecorderPanel";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// FIX: a transcription this signer has already recorded a VALID take for
// (in this session -- "worked" only ever covers this session's own
// recordings) was staying visible in the "Transcriptions to record"
// sidebar list after being recorded. It got a fresh, updated coverage
// badge and sorted differently, but never actually disappeared, because
// nothing on the frontend ever removed it from `pending` -- the sidebar
// just renders whatever `pending` contains. The expectation is that once
// THIS signer has a valid take for a line, it's done for them (even if
// `required_signer_count` > 1 and other signers still owe a take on the
// same line -- that's a different signer's pending list, not this one's).
//
// The authoritative fix belongs in listSignerPendingTranscriptions on the
// backend (it should already be excluding anything this signer has a
// valid take for). This filter is a client-side safety net on top of
// that: it cross-references whatever the server just returned as
// "pending" against this session's own "worked" results and drops any
// transcription that already has a valid take, so the list is correct
// immediately after an upload even if the server-side exclusion has its
// own bug or lag.
function excludeValidlyWorked(
  pendingItems: TranscriptionRow[],
  workedItems: SessionWorkedTranscription[]
): TranscriptionRow[] {
  const validIds = new Set(
    workedItems.filter((w) => w.has_valid_take).map((w) => w.transcription_id)
  );
  if (validIds.size === 0) return pendingItems;
  return pendingItems.filter((t) => !validIds.has(t.transcription_id));
}

export default function SessionDetailPage() {
  const params = useParams<{ job_id: string; session_id: string }>();
  const jobId = params.job_id;
  const sessionId = params.session_id;

  const [job, setJob] = useState<Job | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);

  // OPEN session: what's still left for this signer (across all sessions).
  const [pending, setPending] = useState<TranscriptionRow[]>([]);
  // What was recorded inside THIS session. For an open session it's the
  // "done so far" list; for an ended session it's the whole read-only history.
  const [worked, setWorked] = useState<SessionWorkedTranscription[]>([]);

  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<string | null>(null);

  // True while RecorderPanel is actively recording/uploading a take.
  // Used to warn before ending a session mid-recording -- but NOT to
  // hard-disable the End session button (see confirm dialog below).
  const [recorderBusy, setRecorderBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const isEnded = !!session?.ended_at;

  const selectedTranscription =
    pending.find((t) => t.transcription_id === selectedTranscriptionId) ?? null;

  const selectedWorked =
    worked.find((w) => w.transcription_id === selectedTranscriptionId) ?? null;

  /**
   * Loads everything for the page. If `known` is passed (e.g. the response
   * from the end-session PATCH), it is used as the session instead of
   * re-fetching it, so the UI reflects the server's authoritative answer
   * right away. Returns the session that was used, or null on failure.
   */
  const loadData = useCallback(
    async (known?: SessionDetail): Promise<SessionDetail | null> => {
      setLoading(true);
      setError(null);
      try {
        const [jobDetail, sessionDetail] = await Promise.all([
          getJob(jobId),
          known ? Promise.resolve(known) : getJobSession(jobId, sessionId),
        ]);
        setJob(jobDetail);
        setSession(sessionDetail);

        if (sessionDetail.ended_at) {
          // Ended: show ONLY what was worked on in this session.
          const workedResponse = await listSessionTranscriptions(jobId, sessionId);
          setPending([]);
          setWorked(workedResponse.items);
          setSelectedTranscriptionId((prev) =>
            workedResponse.items.some((w) => w.transcription_id === prev)
              ? prev
              : workedResponse.items[0]?.transcription_id ?? null
          );
        } else {
          // Open: what's still left for the signer + what's done so far here.
          const [pendingResponse, workedResponse] = await Promise.all([
            listSignerPendingTranscriptions(jobId, sessionDetail.signer_id, { limit: 100 }),
            listSessionTranscriptions(jobId, sessionId),
          ]);
          // See excludeValidlyWorked above -- drops anything this signer
          // already has a valid take for, even if the server's own
          // "pending" list hasn't caught up yet.
          const filteredPending = excludeValidlyWorked(pendingResponse.items, workedResponse.items);
          setPending(filteredPending);
          setWorked(workedResponse.items);
          setSelectedTranscriptionId((prev) =>
            filteredPending.some((t) => t.transcription_id === prev)
              ? prev
              : filteredPending[0]?.transcription_id ?? null
          );
        }
        return sessionDetail;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load session.";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [jobId, sessionId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Quiet refresh of both lists (no loading spinner, so RecorderPanel is NOT
  // unmounted). Called when the operator switches transcriptions, and also
  // after a take finishes uploading (see onUploadComplete on RecorderPanel
  // below) so the "done" / "remaining" lists update immediately instead of
  // only on the next transcription switch.
  const refreshLists = useCallback(async () => {
    if (!session || session.ended_at) return;
    try {
      const [pendingResponse, workedResponse] = await Promise.all([
        listSignerPendingTranscriptions(jobId, session.signer_id, { limit: 100 }),
        listSessionTranscriptions(jobId, sessionId),
      ]);
      // Same safety net as loadData -- a transcription that just got a
      // valid take uploaded (this call is what onUploadComplete triggers)
      // must not still show up in "to record" once this resolves.
      const filteredPending = excludeValidlyWorked(pendingResponse.items, workedResponse.items);
      setPending(filteredPending);
      setWorked(workedResponse.items);
      // If the transcription that was selected just got filtered out (e.g.
      // it now has a valid take from this refresh), fall through to the
      // next item in the remaining queue instead of leaving RecorderPanel
      // pointed at a transcription that's no longer in `pending` -- same
      // rule loadData already applies on initial load / session switch.
      setSelectedTranscriptionId((prev) =>
        prev && filteredPending.some((t) => t.transcription_id === prev)
          ? prev
          : filteredPending[0]?.transcription_id ?? null
      );
    } catch {
      // Keep showing the previous lists; the next switch will retry.
    }
  }, [jobId, sessionId, session]);

  const handleSelect = useCallback(
    (transcriptionId: string) => {
      setSelectedTranscriptionId(transcriptionId);
      void refreshLists();
    },
    [refreshLists]
  );

  const handleEndSession = useCallback(async () => {
    // Final confirmation -- ending the session triggers a one-time email
    // to the CSV/job's requestor (see the backend's end-session endpoint),
    // so the copy here makes that consequence explicit before the request
    // fires, on top of the usual "no more uploads / unsaved take" warning.
    const message = recorderBusy
      ? "Final confirmation: end this session?\n\n" +
        "It looks like a recording may still be in progress. Anything you " +
        "recorded but haven't uploaded yet will be lost. " +
        "You won't be able to add recordings to this session afterwards, " +
        "but a new session for the same signer will pick up whatever is still remaining.\n\n" +
        "This will also email the owner who requested this CSV file to let them know " +
        "the session is complete."
      : "Final confirmation: end this session?\n\n" +
        "Anything you recorded but haven't uploaded yet will be lost. " +
        "You won't be able to add recordings to this session afterwards, " +
        "but a new session for the same signer will pick up whatever is still remaining.\n\n" +
        "This will also email the owner who requested this CSV file to let them know " +
        "the session is complete.";

    const ok = window.confirm(message);
    if (!ok) return;

    setEnding(true);
    try {
      const updated = await endJobSession(jobId, sessionId);

      if (!updated?.ended_at) {
        // The request succeeded but the server didn't report the session as
        // ended. Usually: SessionDetailOut is missing `ended_at`, or the
        // handler isn't setting/committing it.
        setError(
          "The end-session request succeeded, but the response has no ended_at. " +
            "Check that SessionDetailOut includes ended_at and the PATCH handler sets and commits it."
        );
        return;
      }

      // Drive the UI from the PATCH response (authoritative), no stale re-fetch.
      await loadData(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't end the session.");
    } finally {
      setEnding(false);
    }
  }, [jobId, sessionId, loadData, recorderBusy]);

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/dashboard/jobs" className={styles.breadcrumbLink}>
          Jobs
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href={`/dashboard/jobs/${jobId}`} className={styles.breadcrumbLink}>
          {job?.filename ?? jobId}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span>Sessions</span>
        <span className={styles.breadcrumbSep}>/</span>
        <span>{session?.signer_name ?? sessionId}</span>
      </nav>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {session ? `${session.signer_name}'s session` : "Session"}
            {session && (
              <span className={styles.statusPill} data-ended={isEnded ? "true" : "false"}>
                {isEnded ? "Ended" : "In progress"}
              </span>
            )}
          </h1>
          {session && (
            <p className={styles.subtitle}>
              Recorded by {session.recorder_name} ·{" "}
              {new Date(session.session_datetime).toLocaleString()}
              {session.ended_at ? ` · Ended ${new Date(session.ended_at).toLocaleString()}` : ""}
            </p>
          )}
        </div>

        {session && !isEnded && (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.endBtn}
              onClick={handleEndSession}
              disabled={ending}
              title={
                recorderBusy
                  ? "A recording may still be in progress -- you'll be asked to confirm."
                  : "Close this session. Remaining transcriptions carry over to the signer's next session. Emails the CSV requestor."
              }
            >
              {ending ? "Ending…" : "End session"}
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <p className={styles.stateText}>Loading session…</p>
      ) : error ? (
        <p className={styles.errorText}>{error}</p>
      ) : !session ? (
        <p className={styles.stateText}>Session not found.</p>
      ) : isEnded ? (
        /* ---------------- Ended session: read-only history ---------------- */
        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <h2 className={styles.sidebarTitle}>Worked on in this session ({worked.length})</h2>

            {worked.length === 0 ? (
              <p className={styles.stateText}>Nothing was recorded in this session.</p>
            ) : (
              <ul className={styles.transcriptionList}>
                {worked.map((w, i) => {
                  const isSelected = selectedTranscriptionId === w.transcription_id;
                  return (
                    <li key={w.transcription_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTranscriptionId(w.transcription_id)}
                        className={`${styles.transcriptionItem} ${
                          isSelected ? styles.transcriptionItemSelected : ""
                        }`}
                      >
                        <span className={styles.transcriptionIndex}>{w.row_number ?? i + 1}</span>
                        <span className={styles.transcriptionBody}>
                          <span className={styles.transcriptionText}>{w.text}</span>
                          <span
                            className={styles.takePill}
                            data-valid={w.has_valid_take ? "true" : "false"}
                          >
                            {w.takes.length} take{w.takes.length === 1 ? "" : "s"} ·{" "}
                            {w.has_valid_take ? "Valid" : "Invalid"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <main className={styles.mainContent}>
            {!selectedWorked ? (
              <p className={styles.stateText}>Select a transcription to see what was recorded.</p>
            ) : (
              <section className={styles.historyPanel}>
                <h2 className={styles.historyTitle}>
                  Recording — #{selectedWorked.row_number ?? ""}
                </h2>
                <p className={styles.historyText}>{selectedWorked.text}</p>

                <ul className={styles.takeList}>
                  {selectedWorked.takes.map((take) => (
                    <li key={take.take_id} className={styles.takeCard}>
                      <div className={styles.takeHeader}>
                        <strong>Take {take.take_number}</strong>
                        <span
                          className={styles.takePill}
                          data-valid={take.is_valid ? "true" : "false"}
                        >
                          {take.is_valid ? "Valid" : "Invalid"}
                        </span>
                        <span className={styles.takeTime}>
                          {new Date(take.created_at).toLocaleString()}
                        </span>
                      </div>

                      {/* One player per camera angle. crossOrigin="use-credentials"
                          makes <video> send the same auth cookie apiFetch sends. */}
                      <div className={styles.videoGrid}>
                        {take.videos.map((v) => (
                          <div key={v.video_id} className={styles.videoTile}>
                            <video
                              className={styles.videoPlayer}
                              src={getVideoFileUrl(jobId, v.video_id)}
                              crossOrigin="use-credentials"
                              controls
                              preload="metadata"
                            />
                            <div className={styles.videoMeta}>
                              <span className={styles.videoAngle}>{v.angle}</span>
                              <span>{formatDuration(v.duration_seconds)}</span>
                              {v.resolution && <span>{v.resolution}</span>}
                              {v.fps != null && <span>{v.fps} fps</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>
        </div>
      ) : (
        /* ---------------- Open session: record what's remaining ---------------- */
        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <h2 className={styles.sidebarTitle}>Transcriptions to record ({pending.length})</h2>

            {pending.length === 0 ? (
              <p className={styles.stateText}>Nothing left for this signer on this job.</p>
            ) : (
              <ul className={styles.transcriptionList}>
                {pending.map((t, i) => {
                  const isSelected = selectedTranscriptionId === t.transcription_id;
                  const complete = t.signers_recorded >= t.required_signer_count;
                  const disabled = recorderBusy && !isSelected;

                  return (
                    <li key={t.transcription_id}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleSelect(t.transcription_id)}
                        className={`${styles.transcriptionItem} ${
                          isSelected ? styles.transcriptionItemSelected : ""
                        }`}
                      >
                        <span
                          className={styles.transcriptionIndex}
                          title={
                            t.row_number != null
                              ? `Row ${t.row_number} in the uploaded CSV`
                              : `Position ${i + 1} in the remaining queue (no row number on this transcription)`
                          }
                        >
                          {t.row_number ?? i + 1}
                        </span>
                        <span className={styles.transcriptionBody}>
                          <span className={styles.transcriptionText}>{t.text}</span>
                          <span
                            className={styles.coverageBadge}
                            data-complete={complete ? "true" : "false"}
                          >
                            {t.signers_recorded}/{t.required_signer_count} signers
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {worked.length > 0 && (
              <>
                <h2 className={`${styles.sidebarTitle} ${styles.sidebarTitleSpaced}`}>
                  Done in this session ({worked.length})
                </h2>
                <ul className={styles.transcriptionList}>
                  {worked.map((w, i) => (
                    <li key={w.transcription_id} className={styles.doneItem}>
                      <span className={styles.transcriptionIndex}>{w.row_number ?? i + 1}</span>
                      <span className={styles.transcriptionBody}>
                        <span className={styles.transcriptionText}>{w.text}</span>
                        <span
                          className={styles.takePill}
                          data-valid={w.has_valid_take ? "true" : "false"}
                        >
                          {w.takes.length} take{w.takes.length === 1 ? "" : "s"} ·{" "}
                          {w.has_valid_take ? "Valid" : "Invalid, retake needed"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>

          <main className={styles.mainContent}>
            <RecorderPanel
              jobId={jobId}
              sessionId={sessionId}
              transcription={selectedTranscription}
              onBusyChange={setRecorderBusy}
              disabled={ending}
              onUploadComplete={refreshLists}
            />
          </main>
        </div>
      )}
    </div>
  );
}