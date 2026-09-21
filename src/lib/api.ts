import { BASE_URL } from "@/config/api";
import type { SignerRecord } from "@/components/CreateSignerModal";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetch wrapper for the backend API. Mirrors the access+refresh flow in
 * lib/auth.ts: on a 401, tries POST /refresh once, then retries the
 * original request. Throws ApiError for any non-2xx response.
 */
async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
    });

  let response = await doFetch();

  if (response.status === 401) {
    const refreshResponse = await fetch(`${BASE_URL}/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refreshResponse.ok) {
      response = await doFetch();
    }
  }

  if (!response.ok) {
    let detail: string = response.statusText;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI's default 422 validation error shape:
        // { detail: [{ loc: [...], msg: "...", type: "..." }, ...] }
        detail = body.detail
          .map((d: { loc?: unknown[]; msg?: string }) =>
            d?.msg ? `${(d.loc ?? []).join(".")}: ${d.msg}` : JSON.stringify(d)
          )
          .join("; ");
      } else if (body.detail) {
        detail = JSON.stringify(body.detail);
      } else if (typeof body.message === "string") {
        detail = body.message;
      }
    } catch {
      // Body wasn't JSON — fall back to statusText.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ---------------- Requestors ----------------

export type Requestor = {
  requestor_id: string;
  name: string;
  email: string | null;
  created_by_user_id: string;
  created_at: string;
};

export type RequestorListResponse = {
  total: number;
  items: Requestor[];
};

export async function listRequestors(
  params: { skip?: number; limit?: number; search?: string } = {}
): Promise<RequestorListResponse> {
  return apiFetch<RequestorListResponse>(`/requestors${toQueryString(params)}`);
}

export async function createRequestor(data: { name: string; email?: string }): Promise<Requestor> {
  const form = new FormData();
  form.set("name", data.name);
  if (data.email) form.set("email", data.email);
  return apiFetch<Requestor>("/requestors", { method: "POST", body: form });
}

// ---------------- Jobs ----------------

export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type JobInsights = {
  total_sentences: number;
  completed_sentences: number;
  pending_sentences: number;
  sessions_count: number;
  progress_percent: number;
};

export type Job = {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  filename: string;
  requestor_id: string;
  requestor_name: string;
  insights: JobInsights;
};

export type JobListResponse = {
  total: number;
  items: Job[];
};

export async function listJobs(
  params: { skip?: number; limit?: number; status?: JobStatus; search?: string } = {}
): Promise<JobListResponse> {
  return apiFetch<JobListResponse>(`/jobs${toQueryString(params)}`);
}

export async function createJob(data: { file: File; requestorId: string }): Promise<Job> {
  const form = new FormData();
  form.set("file", data.file);
  form.set("requestor_id", data.requestorId);
  return apiFetch<Job>("/jobs", { method: "POST", body: form });
}

export async function getJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}`);
}

// ---------------- Job detail: Overview / Transcriptions / Sessions ----------------

export type JobOverviewCoverage = {
  total_transcriptions: number;
  fully_covered_count: number;
  signers_still_needed: number;
  invalid_takes_awaiting_retake: number;
};

export type JobOverview = {
  job_id: string;
  filename: string;
  row_count: number;
  uploaded_by: string;
  uploaded_on: string;
  requestor_id: string;
  requestor_name: string;
  requestor_email: string;
  requestor_added_by: string;
  requestor_added_on: string;
  coverage: JobOverviewCoverage;
};

export async function getJobOverview(jobId: string): Promise<JobOverview> {
  return apiFetch<JobOverview>(`/jobs/${jobId}/overview`);
}

export type TranscriptionRow = {
  transcription_id: string;
  row_number: number | null;
  text: string;
  required_signer_count: number;
  signers_recorded: number;
  coverage_percent: number;
};

export type TranscriptionsListResponse = {
  total: number;
  items: TranscriptionRow[];
};

export async function listJobTranscriptions(
  jobId: string,
  params: { skip?: number; limit?: number; search?: string } = {}
): Promise<TranscriptionsListResponse> {
  return apiFetch<TranscriptionsListResponse>(`/jobs/${jobId}/transcriptions${toQueryString(params)}`);
}

/**
 * Transcriptions in this job that `signerId` has NOT already validly
 * completed. Used to warn the user in StartSessionModal before they
 * submit — an empty list (total === 0) means this signer has nothing
 * left to contribute to the job, and the backend will reject the
 * session outright if they're selected anyway. Also drives the session
 * detail page's "transcriptions to record" sidebar.
 */
export async function listSignerPendingTranscriptions(
  jobId: string,
  signerId: string,
  params: { skip?: number; limit?: number } = {}
): Promise<TranscriptionsListResponse> {
  return apiFetch<TranscriptionsListResponse>(
    `/jobs/${jobId}/signers/${signerId}/pending-transcriptions${toQueryString(params)}`
  );
}

export type SessionRow = {
  session_id: string;
  signer_name: string;
  recorder_name: string;
  session_datetime: string;
  transcription_count: number;
  takes_count: number;
};

export type SessionsListResponse = {
  total: number;
  items: SessionRow[];
};

export async function listJobSessions(
  jobId: string,
  params: { skip?: number; limit?: number } = {}
): Promise<SessionsListResponse> {
  return apiFetch<SessionsListResponse>(`/jobs/${jobId}/sessions${toQueryString(params)}`);
}

/**
 * Fetches a single session, including its signer_id — needed by the
 * session detail page to look up that signer's pending transcriptions
 * (SessionRow, returned by list/create, only has signer_name).
 *
 * `ended_at` is null while the session is open and gets set once
 * `endJobSession` is called; the session detail page uses it to switch
 * between the "record" view and the read-only history view.
 */
export type SessionDetail = {
  session_id: string;
  job_id: string;
  signer_id: string;
  signer_name: string;
  recorder_name: string;
  session_datetime: string;
  ended_at: string | null;
};

export async function getJobSession(jobId: string, sessionId: string): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/jobs/${jobId}/sessions/${sessionId}`);
}

/**
 * Creates a session under a job.
 *
 * There is no recorder field: the backend fills recorded_by_user_id from
 * the authenticated caller (whoever is logged in becomes the recorder),
 * so the client only sends who's signing and when.
 *
 * POST /jobs/{job_id}/sessions, JSON body { signer_id, session_datetime }
 * (the backend parses this as a Pydantic model, not Form fields — unlike
 * createJob/createRequestor/createSigner, this one is not multipart),
 * returning the created session as a SessionRow (transcription_count and
 * takes_count come back as 0 for a brand new session).
 */
export type CreateSessionPayload = {
  signerId: string;
  /** ISO 8601 datetime string, e.g. new Date(...).toISOString() */
  sessionDatetime: string;
};

export async function createSession(
  jobId: string,
  data: CreateSessionPayload
): Promise<SessionRow> {
  return apiFetch<SessionRow>(`/jobs/${jobId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signer_id: data.signerId,
      session_datetime: data.sessionDatetime,
    }),
  });
}

/**
 * Ends an open session. After this, the session becomes read-only (its
 * `ended_at` timestamp is set) and no further takes can be uploaded to
 * it; the session detail page's handleEndSession calls this, then
 * reloads the page in history mode.
 *
 * Any transcriptions this signer still hasn't validly completed simply
 * remain in listSignerPendingTranscriptions and surface again the next
 * time a session is started for them — there's nothing else for this
 * call to reconcile.
 *
 * Backend route: PATCH /jobs/{job_id}/sessions/{session_id}/end,
 * returning the updated SessionDetail. Idempotent on the backend --
 * ending an already-ended session just returns it unchanged.
 */
export async function endJobSession(jobId: string, sessionId: string): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/jobs/${jobId}/sessions/${sessionId}/end`, {
    method: "PATCH",
  });
}

// ---------------- Session recording: existing takes lookup ----------------

/** Mirrors backend ViewAngle enum. */
export type ViewAngle = "FRONT" | "LEFT" | "RIGHT";

export type Video = {
  video_id: string;
  angle: ViewAngle;
  file_path: string;
  duration_seconds: number | null;
  resolution?: string | null;
  fps?: number | null;
};

export type Take = {
  take_id: string;
  take_number: number;
  is_valid: boolean;
  reviewed_by_signer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  videos: Video[];
};

/**
 * Builds the URL that streams a single video's raw file content (see
 * the backend's GET /jobs/{job_id}/videos/{video_id}/file route).
 * Intended to be dropped straight into a <video src>. Because this is a
 * plain <video> element rather than an apiFetch() call, the browser
 * doesn't automatically attach the auth cookie the way `credentials:
 * "include"` does for fetch -- pair this URL with
 * `crossOrigin="use-credentials"` on the <video> tag to get the same
 * cookie-based auth for this cross-origin request. The backend's
 * FileResponse negotiates HTTP Range requests on its own, so seeking in
 * the player works without any extra code here.
 */
export function getVideoFileUrl(jobId: string, videoId: string): string {
  return `${BASE_URL}/jobs/${jobId}/videos/${videoId}/file`;
}

export type SignerTranscriptionRecordings = {
  transcription_id: string;
  signer_id: string;
  has_recordings: boolean;
  takes: Take[];
};

/**
 * Existing takes (valid AND invalid) that this session's signer has
 * already recorded for this transcription — looked up across all of
 * that signer's sessions in this job, not just the current one.
 *
 * Drives the "Record" button on the session detail page:
 * has_recordings === false means nothing exists yet (show a bare record
 * button); true means there's something to show first (playback of
 * existing takes, or a flag for invalid ones awaiting a retake).
 *
 * Requires the "ReadDataset" permission.
 */
export async function getSignerTranscriptionRecordings(
  jobId: string,
  sessionId: string,
  transcriptionId: string
): Promise<SignerTranscriptionRecordings> {
  return apiFetch<SignerTranscriptionRecordings>(
    `/jobs/${jobId}/sessions/${sessionId}/transcriptions/${transcriptionId}/recordings`
  );
}

/**
 * One transcription that was worked on within a specific session, with
 * all the takes recorded for it *in that session*. Used by the session
 * detail page in two places: as the "done so far" list while a session
 * is open, and as the full read-only history once a session has ended.
 *
 * `has_valid_take` is a convenience flag (true if any take in `takes`
 * has is_valid === true) so the sidebar doesn't need to scan the array
 * itself.
 */
export type SessionWorkedTranscription = {
  transcription_id: string;
  row_number: number | null;
  text: string;
  has_valid_take: boolean;
  takes: Take[];
};

export type SessionTranscriptionsListResponse = {
  total: number;
  items: SessionWorkedTranscription[];
};

/**
 * Transcriptions that were worked on within this specific session
 * (scoped to session_id, not just the signer), each with the takes
 * recorded during that session.
 *
 * NOTE: inferred endpoint — GET
 * /jobs/{job_id}/sessions/{session_id}/transcriptions. Confirm the path
 * and response shape against the backend route.
 */
export async function listSessionTranscriptions(
  jobId: string,
  sessionId: string
): Promise<SessionTranscriptionsListResponse> {
  return apiFetch<SessionTranscriptionsListResponse>(
    `/jobs/${jobId}/sessions/${sessionId}/transcriptions`
  );
}

// ---------------- Session recording: video upload ----------------
//
// POST /jobs/{job_id}/sessions/{session_id}/transcriptions/{transcription_id}/videos
// -- confirmed against the backend's upload_take_videos endpoint:
// multipart/form-data with `is_valid` ("true"/"false"), one
// `video_<ANGLE>` file field per clip, and an optional `camera_<ANGLE>`
// JSON field per clip (make/model/serial_number/firmware_version) that
// the backend uses to find-or-create the matching `cameras` row.
//
// Uses XMLHttpRequest rather than apiFetch/fetch specifically because
// it's the only one of the two with a real upload-progress event
// (fetch's ReadableStream progress only covers response bodies, not
// request bodies) -- that's what lets RecorderPanel's progress bar
// reflect actual bytes sent rather than a simulated animation.
//
// Known limitation vs. apiFetch: this does NOT go through the
// access+refresh retry flow apiFetch has for a 401. A large video
// upload can run long enough for the access token to expire mid-flight,
// and unlike a JSON request there's no cheap way to replay a
// multipart body after a refresh without re-reading every Blob. If a
// 401 becomes a real problem in practice, the fix is likely: refresh
// proactively before starting the upload, not mid-upload.

/**
 * Hardware identity of the camera that recorded a clip, as reported by
 * the local agent (see useAgentConnection's CameraMetadata) at the
 * moment the attempt started. Structurally compatible with that type on
 * purpose, without importing it, so lib/api.ts doesn't take a
 * dependency on a hook.
 */
export type UploadTakeCameraMetadata = {
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  firmware_version?: string | null;
};

export type UploadTakeVideoFile = {
  /** e.g. "FRONT" | "LEFT" | "RIGHT" -- see lib/cameraAssignments.ts */
  angle: string;
  filename: string;
  blob: Blob;
  /**
   * Sent as the `camera_<ANGLE>` form field (JSON) alongside
   * `video_<ANGLE>` when present. Omit, or pass null/undefined, when the
   * local agent didn't report hardware metadata for this clip -- the
   * backend falls back to the oldest camera already registered for that
   * angle in that case.
   */
  camera?: UploadTakeCameraMetadata | null;
};

const VIDEO_FIELD_PREFIX = "video_";

export function uploadTakeVideos(
  jobId: string,
  sessionId: string,
  transcriptionId: string,
  targets: UploadTakeVideoFile[],
  isValid: boolean,
  onProgress: (fraction: number) => void,
  registerXhr: (xhr: XMLHttpRequest) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    targets.forEach((t) => {
      form.append(`${VIDEO_FIELD_PREFIX}${t.angle}`, t.blob, t.filename);
      if (t.camera) {
        form.append(`camera_${t.angle}`, JSON.stringify(t.camera));
      }
    });
    form.set("is_valid", String(isValid));

    const xhr = new XMLHttpRequest();
    registerXhr(xhr);
    xhr.open(
      "POST",
      `${BASE_URL}/jobs/${jobId}/sessions/${sessionId}/transcriptions/${transcriptionId}/videos`,
      true
    );
    xhr.withCredentials = true; // same auth pattern as every other apiFetch call
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(evt.loaded / evt.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(safeJsonParse(xhr.responseText));
      } else {
        const detail =
          (safeJsonParse(xhr.responseText) as { detail?: string } | null)?.detail ?? xhr.statusText;
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
}

// ---------------- Signers ----------------
// Matches GET /signers: skip (>=0), limit (1-100), search, gender, is_deaf.

export type { SignerRecord };

export type SignerListResponse = {
  total: number;
  items: SignerRecord[];
};

export async function listSigners(
  params: {
    skip?: number;
    limit?: number;
    search?: string;
    gender?: "MALE" | "FEMALE";
    is_deaf?: boolean;
  } = {}
): Promise<SignerListResponse> {
  return apiFetch<SignerListResponse>(
    `/signers${toQueryString({
      skip: params.skip,
      limit: params.limit,
      search: params.search,
      gender: params.gender,
      is_deaf: params.is_deaf === undefined ? undefined : String(params.is_deaf),
    })}`
  );

}

// Recorder is not a separate concept: sessions are created by the
// logged-in user, and the backend records recorded_by_user_id from the
// authenticated caller automatically. No recorders endpoint needed.