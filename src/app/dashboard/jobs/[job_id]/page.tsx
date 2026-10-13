"use client";

// Location: src/app/dashboard/jobs/[job_id]/page.tsx

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./page.module.css";
import StartSessionModal from "./StartSessionModal";
import {
  getJob,
  getJobOverview,
  listJobTranscriptions,
  listJobSessions,
  listRecorders,
  assignSession,
  ApiError,
  type Job,
  type JobOverview,
  type TranscriptionRow,
  type SessionRow,
  type Recorder,
} from "@/lib/api";

type Tab = "overview" | "transcriptions" | "sessions";

const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  transcriptions: "Transcriptions",
  sessions: "Sessions",
};

function displayJobId(jobId: string): string {
  // Same placeholder scheme as the jobs list page until a real
  // sequential job_number field exists on the backend.
  return `JOB-${jobId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function displaySessionId(sessionId: string): string {
  return `SES-${sessionId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function JobDetailPage() {
  const params = useParams<{ job_id: string }>();
  const jobId = params.job_id;
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("overview");

  const [job, setJob] = useState<Job | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);

  const [overview, setOverview] = useState<JobOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [transcriptions, setTranscriptions] = useState<TranscriptionRow[] | null>(null);
  const [transcriptionsLoading, setTranscriptionsLoading] = useState(false);
  const [transcriptionsError, setTranscriptionsError] = useState<string | null>(null);

  // Raw text box value vs. the debounced term actually sent to the API,
  // so we don't fire a request on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // Recorders for the "Assigned to" dropdown. `null` = not fetched yet.
  // If the fetch fails (e.g. 403 because the user lacks AssignSessions),
  // `canAssign` stays false and the column is shown as plain read-only text.
  const [recorders, setRecorders] = useState<Recorder[] | null>(null);
  const [canAssign, setCanAssign] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [isStartSessionOpen, setIsStartSessionOpen] = useState(false);

  // Header (job id, filename, requestor, status) loads once.
  useEffect(() => {
    if (!jobId) return;
    getJob(jobId)
      .then(setJob)
      .catch((err) => setHeaderError(err instanceof ApiError ? err.message : "Couldn't load job."));
  }, [jobId]);

  // Debounce the search box into searchTerm.
  useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Lazily fetch overview/sessions the first time their tab is opened, so
  // switching tabs after that is instant and we don't fetch data the user
  // never views. Transcriptions is the exception: it refetches whenever
  // searchTerm changes, since a new search term means new results.
  useEffect(() => {
    if (!jobId) return;

    if (tab === "overview" && overview === null && !overviewLoading) {
      setOverviewLoading(true);
      setOverviewError(null);
      getJobOverview(jobId)
        .then(setOverview)
        .catch((err) => setOverviewError(err instanceof ApiError ? err.message : "Couldn't load overview."))
        .finally(() => setOverviewLoading(false));
    }

    if (tab === "transcriptions") {
      setTranscriptionsLoading(true);
      setTranscriptionsError(null);
      listJobTranscriptions(jobId, { limit: 200, search: searchTerm || undefined })
        .then((res) => setTranscriptions(res.items))
        .catch((err) =>
          setTranscriptionsError(err instanceof ApiError ? err.message : "Couldn't load transcriptions.")
        )
        .finally(() => setTranscriptionsLoading(false));
    }

    if (tab === "sessions" && sessions === null && !sessionsLoading) {
      setSessionsLoading(true);
      setSessionsError(null);
      listJobSessions(jobId, { limit: 100 })
        .then((res) => setSessions(res.items))
        .catch((err) => setSessionsError(err instanceof ApiError ? err.message : "Couldn't load sessions."))
        .finally(() => setSessionsLoading(false));
    }

    // Recorders are fetched once, alongside the first visit to the Sessions
    // tab. Any failure just means the user can't assign -> read-only column.
    if (tab === "sessions" && recorders === null) {
      listRecorders()
        .then((res) => {
          setRecorders(res);
          setCanAssign(true);
        })
        .catch(() => {
          setRecorders([]);
          setCanAssign(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, jobId, searchTerm]);

  // After a session is created on the backend: optimistically insert the
  // real created session into the cached list at its correct sorted
  // position (matching listJobSessions' own order: session_datetime desc),
  // refresh the header insights (session count changed), and jump to the
  // Sessions tab.
  //
  // We insert rather than always prepend because the session's date/time
  // is user-chosen and can be backdated — prepending unconditionally would
  // put it visually out of order until the next full refetch.
  //
  // If sessions haven't been fetched yet at all (still null), just leave it
  // null — the effect above will fetch the full list, new session included,
  // the first time the Sessions tab is opened.
  function handleSessionCreated(session: SessionRow) {
    setSessions((prev) => {
      if (!prev) return prev;
      const insertAt = prev.findIndex(
        (s) => new Date(s.session_datetime).getTime() < new Date(session.session_datetime).getTime()
      );
      if (insertAt === -1) return [...prev, session];
      return [...prev.slice(0, insertAt), session, ...prev.slice(insertAt)];
    });
    if (jobId) {
      getJob(jobId)
        .then(setJob)
        .catch(() => {
          /* header insights are a nice-to-have refresh; ignore failures here */
        });
    }
    setTab("sessions");
  }

  function handleSessionRowClick(session: SessionRow) {
    if (!jobId) return;
    router.push(`/dashboard/jobs/${jobId}/sessions/${session.session_id}`);
  }

  function handleTranscriptionRowClick(transcription: TranscriptionRow) {
    if (!jobId) return;
    router.push(`/dashboard/jobs/${jobId}/transcriptions/${transcription.transcription_id}`);
  }

  // Assigns a session to the chosen recorder. The <select> is controlled by
  // `sessions` state, so on failure nothing is updated and the dropdown
  // simply snaps back to the previous value.
  async function handleAssign(session: SessionRow, recorderId: string) {
    if (!jobId || !recorderId || recorderId === session.recorder_id) return;
    const recorder = recorders?.find((r) => r.user_id === recorderId);
    if (!recorder) return;

    setAssigningId(session.session_id);
    setAssignError(null);
    try {
      await assignSession(jobId, session.session_id, recorderId);
      setSessions((prev) =>
        prev
          ? prev.map((s) =>
              s.session_id === session.session_id
                ? { ...s, recorder_id: recorder.user_id, recorder_name: recorder.name }
                : s
            )
          : prev
      );
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : "Couldn't assign the session.");
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <a href="/dashboard/jobs" className={styles.breadcrumbLink}>
          Jobs
        </a>
        <span className={styles.breadcrumbSep}>/</span>
        <span>{job ? displayJobId(job.job_id) : "…"}</span>
      </div>

      {headerError ? (
        <p className={styles.errorText}>{headerError}</p>
      ) : (
        <>
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>{job ? displayJobId(job.job_id) : "Loading…"}</h1>
              {job && (
                <p className={styles.subtitle}>
                  {job.filename} · {job.requestor_name}
                </p>
              )}
            </div>
            <div className={styles.headerActions}>
              <button type="button" className={styles.primaryButton} onClick={() => setIsStartSessionOpen(true)}>
                Start session
              </button>
            </div>
          </div>

          <div className={styles.tabs}>
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`${styles.tabButton} ${tab === t ? styles.tabButtonActive : ""}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className={styles.tabPanel}>
              {overviewLoading ? (
                <p className={styles.stateText}>Loading overview…</p>
              ) : overviewError ? (
                <p className={styles.errorText}>{overviewError}</p>
              ) : overview ? (
                <>
                  <div className={styles.cardsRow}>
                    <div className={styles.card}>
                      <h2 className={styles.cardTitle}>Source file</h2>
                      <dl className={styles.dl}>
                        <div className={styles.dlRow}>
                          <dt>Filename</dt>
                          <dd>{overview.filename}</dd>
                        </div>
                        <div className={styles.dlRow}>
                          <dt>Rows</dt>
                          <dd>{overview.row_count} transcriptions</dd>
                        </div>
                        <div className={styles.dlRow}>
                          <dt>Uploaded by</dt>
                          <dd>{overview.uploaded_by}</dd>
                        </div>
                        <div className={styles.dlRow}>
                          <dt>Uploaded on</dt>
                          <dd>{formatDateTime(overview.uploaded_on)}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className={styles.card}>
                      <h2 className={styles.cardTitle}>Requestor</h2>
                      <dl className={styles.dl}>
                        <div className={styles.dlRow}>
                          <dt>Name</dt>
                          <dd>{overview.requestor_name}</dd>
                        </div>
                        <div className={styles.dlRow}>
                          <dt>Email</dt>
                          <dd>{overview.requestor_email}</dd>
                        </div>
                        <div className={styles.dlRow}>
                          <dt>Requested via</dt>
                          <dd>
                            Added by {overview.requestor_added_by} on {formatDate(overview.requestor_added_on)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <h2 className={styles.sectionTitle}>Coverage</h2>
                  <div className={styles.coverageCard}>
                    <div className={styles.coverageRow}>
                      <span>Transcriptions fully covered</span>
                      <strong>
                        {overview.coverage.fully_covered_count} of {overview.coverage.total_transcriptions}
                      </strong>
                    </div>
                    <div className={styles.coverageRow}>
                      <span>Signers still needed</span>
                      <strong>{overview.coverage.signers_still_needed}</strong>
                    </div>
                    <div className={styles.coverageRow}>
                      <span>Takes flagged invalid, awaiting re-take</span>
                      <strong>{overview.coverage.invalid_takes_awaiting_retake}</strong>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {tab === "transcriptions" && (
            <div className={styles.tabPanel}>
              <div className={styles.searchRow}>
                <input
                  type="text"
                  placeholder="Search sentences…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              {transcriptionsLoading ? (
                <p className={styles.stateText}>Loading transcriptions…</p>
              ) : transcriptionsError ? (
                <p className={styles.errorText}>{transcriptionsError}</p>
              ) : !transcriptions || transcriptions.length === 0 ? (
                <p className={styles.stateText}>
                  {searchTerm ? `No sentences matching "${searchTerm}".` : "No transcriptions yet."}
                </p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Sentence</th>
                        <th>Signers needed</th>
                        <th>Signers recorded</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transcriptions.map((t, i) => (
                        <tr
                          key={t.transcription_id}
                          onClick={() => handleTranscriptionRowClick(t)}
                          className={styles.clickableRow}
                        >
                          <td>{t.row_number ?? i + 1}</td>
                          <td>{t.text}</td>
                          <td>{t.required_signer_count}</td>
                          <td>{t.signers_recorded}</td>
                          <td>
                            <div className={styles.progressCell}>
                              <div className={styles.progressTrack}>
                                <div
                                  className={`${styles.progressFill} ${
                                    t.coverage_percent === 100 ? styles.progressFillDone : ""
                                  }`}
                                  style={{ width: `${t.coverage_percent}%` }}
                                />
                              </div>
                              <span className={styles.progressPercent}>{t.coverage_percent}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "sessions" && (
            <div className={styles.tabPanel}>
              {assignError && <p className={styles.errorText}>{assignError}</p>}

              {sessionsLoading ? (
                <p className={styles.stateText}>Loading sessions…</p>
              ) : sessionsError ? (
                <p className={styles.errorText}>{sessionsError}</p>
              ) : !sessions || sessions.length === 0 ? (
                <p className={styles.stateText}>No sessions yet.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Signer</th>
                        <th>Assigned to</th>
                        <th>Date &amp; time (IST)</th>
                        <th>Transcriptions</th>
                        <th>Takes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => {
                        // If the current assignee isn't in the recorders list
                        // (e.g. the session defaulted to its creator, who
                        // isn't a Recorder), no option matches -> the
                        // dropdown shows empty, ready for a selection.
                        const selectedValue = recorders?.some((r) => r.user_id === s.recorder_id)
                          ? s.recorder_id
                          : "";
                        return (
                          <tr
                            key={s.session_id}
                            onClick={() => handleSessionRowClick(s)}
                            className={styles.clickableRow}
                          >
                            <td className={styles.mono}>{displaySessionId(s.session_id)}</td>
                            <td>{s.signer_name}</td>
                            <td>
                              {canAssign ? (
                                <select
                                  className={styles.assignSelect}
                                  value={selectedValue}
                                  disabled={assigningId === s.session_id || !!s.ended_at}
                                  title={s.ended_at ? "This session has ended" : undefined}
                                  // Keep clicks on the dropdown from opening the session page.
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => handleAssign(s, e.target.value)}
                                >
                                  <option value="" disabled>
                                    Select recorder
                                  </option>
                                  {recorders?.map((r) => (
                                    <option key={r.user_id} value={r.user_id}>
                                      {r.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                s.recorder_name
                              )}
                            </td>
                            <td>{formatDateTime(s.session_datetime)}</td>
                            <td>{s.transcription_count}</td>
                            <td>{s.takes_count}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {jobId && (
        <StartSessionModal
          jobId={jobId}
          isOpen={isStartSessionOpen}
          onClose={() => setIsStartSessionOpen(false)}
          onCreated={handleSessionCreated}
        />
      )}
    </div>
  );
}