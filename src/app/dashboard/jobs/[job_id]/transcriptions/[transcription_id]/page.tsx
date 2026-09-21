"use client";

// Location: src/app/dashboard/jobs/[job_id]/transcriptions/[transcription_id]/page.tsx
//
// Review page for ONE transcription across every signer who has ever
// attempted it, in any session. Backed by:
//   GET /jobs/{job_id}/transcriptions/{transcription_id}/takes
// which groups every take by signer_id/signer_name, and:
//   GET /jobs/{job_id}/videos/{video_id}/file
// which streams the actual video bytes for playback, and:
//   PATCH /jobs/{job_id}/takes/{take_id}/validate
// which flips a take's is_valid status (requires CreateDataset permission).
//
// TODO(integration): this file makes its own fetch() calls with a local
// API_BASE_URL constant and a bare `fetch(..., { credentials: "include" })`
// rather than going through your existing lib/api.ts helper (getJob,
// listSignerPendingTranscriptions, etc.), because that file's contents
// (its base URL constant, its auth-header/cookie handling, its ApiError
// class) weren't available while writing this. Swap the fetch helpers
// below for real lib/api.ts exports once you've wired them there.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

// TODO(integration): replace with your app's real API base URL constant
// (likely already exported from lib/api.ts).
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

interface VideoOut {
  video_id: string;
  angle: string;
  file_path: string;
  duration_seconds: number | null;
  resolution: string | null;
  fps: number | null;
}

interface TakeOut {
  take_id: string;
  take_number: number;
  is_valid: boolean;
  reviewed_by_signer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  videos: VideoOut[];
}

interface SignerTakes {
  signer_id: string;
  signer_name: string;
  has_valid_take: boolean;
  takes: TakeOut[];
}

interface TranscriptionTakesResponse {
  transcription_id: string;
  text: string;
  required_signer_count: number;
  signers: SignerTakes[];
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchTranscriptionTakes(
  jobId: string,
  transcriptionId: string
): Promise<TranscriptionTakesResponse> {
  const res = await fetch(
    `${API_BASE_URL}/jobs/${jobId}/transcriptions/${transcriptionId}/takes`,
    { credentials: "include" }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

async function validateTake(
  jobId: string,
  takeId: string,
  isValid: boolean
): Promise<TakeOut> {
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/takes/${takeId}/validate`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_valid: isValid }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

function videoFileUrl(jobId: string, videoId: string): string {
  return `${API_BASE_URL}/jobs/${jobId}/videos/${videoId}/file`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TranscriptionTakesPage() {
  const params = useParams<{ job_id: string; transcription_id: string }>();
  const jobId = params.job_id;
  const transcriptionId = params.transcription_id;

  const [data, setData] = useState<TranscriptionTakesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedSignerId, setExpandedSignerId] = useState<string | null>(null);
  const [activeTakeBySigner, setActiveTakeBySigner] = useState<Record<string, string>>({});

  // take_id of the take currently being validated, so only that button
  // shows a loading state instead of locking the whole page.
  const [validatingTakeId, setValidatingTakeId] = useState<string | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTranscriptionTakes(jobId, transcriptionId);
      setData(result);
      setExpandedSignerId((prev) => {
        if (prev) return prev;
        const firstIncomplete = result.signers.find((s) => !s.has_valid_take);
        return (firstIncomplete ?? result.signers[0])?.signer_id ?? null;
      });
      setActiveTakeBySigner((prev) => {
        const next = { ...prev };
        result.signers.forEach((s) => {
          if (!next[s.signer_id] && s.takes.length > 0) {
            next[s.signer_id] = s.takes[s.takes.length - 1].take_id;
          }
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load takes.");
    } finally {
      setLoading(false);
    }
  }, [jobId, transcriptionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Applies a validated take's new status into local state without a
  // full refetch, and recomputes that signer's has_valid_take flag.
  const applyValidationResult = useCallback((signerId: string, updated: TakeOut) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        signers: prev.signers.map((signer) => {
          if (signer.signer_id !== signerId) return signer;
          const takes = signer.takes.map((t) => (t.take_id === updated.take_id ? updated : t));
          return {
            ...signer,
            takes,
            has_valid_take: takes.some((t) => t.is_valid),
          };
        }),
      };
    });
  }, []);

  const handleValidate = useCallback(
    async (signerId: string, takeId: string, isValid: boolean) => {
      setValidatingTakeId(takeId);
      setValidateError(null);
      try {
        const updated = await validateTake(jobId, takeId, isValid);
        applyValidationResult(signerId, updated);
      } catch (err) {
        setValidateError(err instanceof ApiError ? err.message : "Failed to update validation.");
      } finally {
        setValidatingTakeId(null);
      }
    },
    [jobId, applyValidationResult]
  );

  const signersDone = useMemo(
    () => data?.signers.filter((s) => s.has_valid_take).length ?? 0,
    [data]
  );

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/dashboard/jobs" className={styles.breadcrumbLink}>
          Jobs
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href={`/dashboard/jobs/${jobId}`} className={styles.breadcrumbLink}>
          {jobId}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span>Transcription</span>
      </nav>

      {loading ? (
        <p className={styles.stateText}>Loading takes…</p>
      ) : error ? (
        <p className={styles.errorText}>{error}</p>
      ) : !data ? (
        <p className={styles.stateText}>Not found.</p>
      ) : (
        <>
          <header className={styles.header}>
            <p className={styles.sentenceText}>{data.text}</p>
            <span className={styles.coverageSummary}>
              {signersDone}/{data.required_signer_count} signers have a valid take
              {data.signers.length > data.required_signer_count
                ? ` · ${data.signers.length} have attempted it`
                : ""}
            </span>
          </header>

          {validateError && <p className={styles.errorText}>{validateError}</p>}

          {data.signers.length === 0 ? (
            <p className={styles.stateText}>No one has recorded this transcription yet.</p>
          ) : (
            <ul className={styles.signerList}>
              {data.signers.map((signer) => {
                const expanded = expandedSignerId === signer.signer_id;
                const activeTakeId = activeTakeBySigner[signer.signer_id];
                const activeTake =
                  signer.takes.find((t) => t.take_id === activeTakeId) ??
                  signer.takes[signer.takes.length - 1] ??
                  null;

                return (
                  <li key={signer.signer_id} className={styles.signerCard}>
                    <button
                      type="button"
                      className={styles.signerHeader}
                      onClick={() =>
                        setExpandedSignerId((prev) => (prev === signer.signer_id ? null : signer.signer_id))
                      }
                      aria-expanded={expanded}
                    >
                      <span className={styles.signerName}>{signer.signer_name}</span>
                      <span className={styles.signerMeta}>
                        <span
                          className={styles.validBadge}
                          data-valid={signer.has_valid_take ? "true" : "false"}
                        >
                          {signer.has_valid_take ? "✓ Valid take" : "Needs review"}
                        </span>
                        <span className={styles.takeCount}>
                          {signer.takes.length} take{signer.takes.length === 1 ? "" : "s"}
                        </span>
                        <span className={styles.chevron} data-open={expanded ? "true" : "false"}>
                          ▾
                        </span>
                      </span>
                    </button>

                    {expanded && (
                      <div className={styles.signerBody}>
                        {signer.takes.length > 1 && (
                          <div className={styles.takeTabs}>
                            {signer.takes.map((take) => (
                              <button
                                key={take.take_id}
                                type="button"
                                className={styles.takeTab}
                                data-active={take.take_id === activeTake?.take_id ? "true" : "false"}
                                onClick={() =>
                                  setActiveTakeBySigner((prev) => ({
                                    ...prev,
                                    [signer.signer_id]: take.take_id,
                                  }))
                                }
                              >
                                Take {take.take_number}
                                <span
                                  className={styles.takeTabDot}
                                  data-valid={take.is_valid ? "true" : "false"}
                                />
                              </button>
                            ))}
                          </div>
                        )}

                        {activeTake && (
                          <>
                            <div className={styles.takeMeta}>
                              <span
                                className={styles.validBadge}
                                data-valid={activeTake.is_valid ? "true" : "false"}
                              >
                                {activeTake.is_valid ? "Valid" : "Invalid"}
                              </span>
                              <span className={styles.takeMetaText}>
                                Recorded {formatDateTime(activeTake.created_at)}
                                {activeTake.reviewed_at
                                  ? ` · reviewed ${formatDateTime(activeTake.reviewed_at)}`
                                  : ""}
                              </span>

                              <span className={styles.validateActions}>
                                <button
                                  type="button"
                                  className={styles.validateButton}
                                  data-kind="valid"
                                  disabled={
                                    activeTake.is_valid || validatingTakeId === activeTake.take_id
                                  }
                                  onClick={() =>
                                    handleValidate(signer.signer_id, activeTake.take_id, true)
                                  }
                                >
                                  {validatingTakeId === activeTake.take_id
                                    ? "Saving…"
                                    : "Mark valid"}
                                </button>
                                <button
                                  type="button"
                                  className={styles.validateButton}
                                  data-kind="invalid"
                                  disabled={
                                    !activeTake.is_valid || validatingTakeId === activeTake.take_id
                                  }
                                  onClick={() =>
                                    handleValidate(signer.signer_id, activeTake.take_id, false)
                                  }
                                >
                                  {validatingTakeId === activeTake.take_id
                                    ? "Saving…"
                                    : "Mark invalid"}
                                </button>
                              </span>
                            </div>

                            {activeTake.videos.length === 0 ? (
                              <p className={styles.stateText}>No videos on this take.</p>
                            ) : (
                              <div className={styles.videoGrid}>
                                {activeTake.videos.map((video) => (
                                  <div key={video.video_id} className={styles.videoTile}>
                                    <video
                                      className={styles.video}
                                      src={videoFileUrl(jobId, video.video_id)}
                                      controls
                                      playsInline
                                    />
                                    <div className={styles.videoLabel}>
                                      <span>{video.angle}</span>
                                      <span className={styles.videoLabelMeta}>
                                        {formatDuration(video.duration_seconds)}
                                        {video.resolution ? ` · ${video.resolution}` : ""}
                                        {video.fps ? ` · ${video.fps.toFixed(1)}fps` : ""}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}