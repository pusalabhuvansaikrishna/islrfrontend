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

/**
 * One row of the Sessions tab.
 *
 * `recorder_id` / `recorder_name` identify the session's ASSIGNEE (the
 * backend's recorded_by_user_id) -- the person who records it. This can be
 * a user who isn't (or is no longer) in the Recorder role, e.g. when the
 * session defaulted to whoever created it; the Sessions tab's dropdown
 * shows empty in that case.
 *
 * `ended_at` is null while the session is open.
 */
export type SessionRow = {
  session_id: string;
  signer_name: string;
  recorder_id: string;
  recorder_name: string;
  session_datetime: string;
  ended_at?: string | null;
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
 * `recorder_id` / `recorder_name` identify the session's assignee.
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
  recorder_id: string;
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
 * The backend always records the authenticated caller as the session's
 * creator (created_by_user_id). The ASSIGNEE (recorded_by_user_id) defaults
 * to the caller too; pass `recorderId` to assign the session to someone else
 * at creation time. That requires the "AssignSessions" permission, and the
 * chosen user must be an active user with the Recorder role (see
 * listRecorders).
 *
 * POST /jobs/{job_id}/sessions, JSON body
 * { signer_id, session_datetime, recorded_by_user_id? }
 * (the backend parses this as a Pydantic model, not Form fields — unlike
 * createJob/createRequestor/createSigner, this one is not multipart),
 * returning the created session as a SessionRow (transcription_count and
 * takes_count come back as 0 for a brand new session).
 */
export type CreateSessionPayload = {
  signerId: string;
  /** ISO 8601 datetime string, e.g. new Date(...).toISOString() */
  sessionDatetime: string;
  /** Optional assignee. Omit to assign the session to yourself. */
  recorderId?: string;
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
      ...(data.recorderId ? { recorded_by_user_id: data.recorderId } : {}),
    }),
  });
}

// ---------------- Recorders & session assignment ----------------

/**
 * A user with the Recorder role -- someone a session can be assigned to.
 */
export type Recorder = {
  user_id: string;
  name: string;
  username: string;
  email: string | null;
};

/**
 * Active users with the Recorder role, sorted by name. Powers the
 * "Assigned to" dropdown on the Sessions tab.
 *
 * Backend route: GET /jobs/recorders (optional ?search= matching name,
 * username or email). Requires the "AssignSessions" permission -- callers
 * without it get a 403 (ApiError.status === 403), which the Sessions tab
 * treats as "read-only: show the assignee as plain text".
 */
export async function listRecorders(params: { search?: string } = {}): Promise<Recorder[]> {
  return apiFetch<Recorder[]>(`/jobs/recorders${toQueryString(params)}`);
}

/**
 * Assigns (or re-assigns) a session to a recorder.
 *
 * Backend route: PATCH /jobs/{job_id}/sessions/{session_id}/assign,
 * JSON body { recorded_by_user_id }, returning the updated SessionDetail
 * (its `recorder_name` is the new assignee). Requires "AssignSessions".
 *
 * Errors worth surfacing to the user:
 *   - 400: the user isn't an active Recorder
 *   - 409: the session has already ended, or that recorder already has a
 *          session for the same signer at the same date/time
 */
export async function assignSession(
  jobId: string,
  sessionId: string,
  recorderId: string
): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/jobs/${jobId}/sessions/${sessionId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recorded_by_user_id: recorderId }),
  });
}

/**
 * One row of the "Assigned Sessions" page: a session assigned to the
 * logged-in user, plus enough job context to link to it
 * (/dashboard/jobs/{job_id}/sessions/{session_id}).
 */
export type AssignedSession = {
  session_id: string;
  job_id: string;
  job_filename: string;
  requestor_name: string;
  signer_id: string;
  signer_name: string;
  /** Who created / assigned the session. */
  assigned_by_name: string;
  session_datetime: string;
  /** null while the session is open. */
  ended_at: string | null;
  transcription_count: number;
  takes_count: number;
};

export type AssignedSessionsListResponse = {
  total: number;
  items: AssignedSession[];
};

/**
 * Sessions assigned to the logged-in user, across all jobs, newest first.
 * No permission needed -- the backend scopes it to the caller.
 *
 * Backend route: GET /sessions/assigned
 *   ended: true  -> only ended sessions
 *          false -> only open sessions
 *          omitted -> both
 */
export async function listMyAssignedSessions(
  params: { skip?: number; limit?: number; ended?: boolean } = {}
): Promise<AssignedSessionsListResponse> {
  return apiFetch<AssignedSessionsListResponse>(
    `/sessions/assigned${toQueryString({
      skip: params.skip,
      limit: params.limit,
      ended: params.ended === undefined ? undefined : String(params.ended),
    })}`
  );
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
 * Requires the "ReadDataset" permission, and the caller must be the
 * session's assignee (or hold a see-all-sessions permission).
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

// ---------------- Videos: search takes by transcription text ----------------
//
// GET /videos/search -- results are GROUPED:
//
//   TranscriptionGroup          (one sentence)
//     └─ takes: VideoTake[]     (one per take_id; valid/invalid, signer, session)
//          └─ videos: TakeVideo[]   (one per camera angle)
//               └─ notes / tags / translations   (optional extras, per video)
//
// Paging is over sentences (groups), so all of a sentence's takes always
// arrive together. Requires "ReadDataset".

export type TakeVideoCamera = {
  camera_id: string;
  label: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  firmware_version: string | null;
};

export type TakeVideo = {
  video_id: string;
  angle: ViewAngle;
  duration_seconds: number | null;
  resolution: string | null;
  fps: number | null;
  /** Relative API path -- prefix with BASE_URL (see takeVideoUrl). */
  stream_url: string;
  camera: TakeVideoCamera | null;
  /** Newest first. Empty when the video has no notes. */
  notes: VideoNote[];
  /** Sorted by name. Empty when the video has no tags. */
  tags: VideoTag[];
  /** Sorted by key. Empty when the video has no translations. */
  translations: Translation[];
  /** The video's latest annotation request, or null if it was never submitted. */
  annotation?: VideoAnnotationStatus | null;
};

/** Latest annotation request raised for a video (see submitVideoForAnnotation). */
export type VideoAnnotationStatus = {
  job_id: string;
  status: JobStatus;
  created_at: string;
  raised_by_name: string;
  assigned_to_name: string | null;
};

/** A free-text note on a video. A video can have any number of them. */
export type VideoNote = {
  note_id: string;
  text: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

/** A reusable label on a video (e.g. "blurry"). */
export type VideoTag = {
  tag_id: string;
  name: string;
};

/**
 * A user-defined key/value translation of a video (e.g. key "Telugu").
 * A video holds at most one value per key (case-insensitive).
 */
export type Translation = {
  translation_id: string;
  key: string;
  value: string;
  updated_at: string;
};

export type TranslationKey = {
  key: string;
  /** Number of videos that already use this key. */
  usage_count: number;
};

export type VideoTake = {
  take_id: string;
  /** Restarts at 1 in every session, so two takes of one sentence can both be "Take 1" -- use `session` to tell them apart. */
  take_number: number;
  is_valid: boolean;
  created_at: string;
  review: {
    reviewed_by_signer_id: string | null;
    reviewed_by_signer_name: string | null;
    reviewed_at: string | null;
  };
  session: {
    session_id: string;
    session_datetime: string;
    ended_at: string | null;
    recorder_id: string;
    recorder_name: string;
    created_by_name: string;
  };
  signer: {
    signer_id: string;
    name: string;
    age: number;
    gender: "MALE" | "FEMALE";
    is_deaf: boolean;
  };
  videos: TakeVideo[];
};

export type TranscriptionGroup = {
  transcription: {
    transcription_id: string;
    row_number: number | null;
    text: string;
    required_signer_count: number;
  };
  job: {
    job_id: string;
    status: JobStatus;
    filename: string;
    requestor_id: string;
    requestor_name: string;
    requestor_email: string | null;
  };
  /** Counted over the takes that matched the filters. */
  take_count: number;
  valid_take_count: number;
  takes: VideoTake[];
};

export type TranscriptionGroupsResponse = {
  /** Number of matching sentences (paging is over these). */
  total: number;
  items: TranscriptionGroup[];
};

export async function searchTakeVideos(
  params: {
    /** Case-insensitive substring match on the sentence text. */
    q?: string;
    /** Narrow to one specific sentence. */
    transcriptionId?: string;
    /** true = valid takes only, false = invalid takes only. */
    isValid?: boolean;
    jobId?: string;
    signerId?: string;
    skip?: number;
    limit?: number;
  } = {}
): Promise<TranscriptionGroupsResponse> {
  return apiFetch<TranscriptionGroupsResponse>(
    `/videos/search${toQueryString({
      q: params.q,
      transcription_id: params.transcriptionId,
      is_valid: params.isValid === undefined ? undefined : String(params.isValid),
      job_id: params.jobId,
      signer_id: params.signerId,
      skip: params.skip,
      limit: params.limit,
    })}`
  );
}

/** Full URL for a video's `stream_url`, ready for a <video src> (use crossOrigin="use-credentials"). */
export function takeVideoUrl(video: Pick<TakeVideo, "stream_url">): string {
  return `${BASE_URL}${video.stream_url}`;
}

// ---------------- Videos: notes, tags and translations ----------------
//
// All three are attached to a single VIDEO (one camera angle of a take).
// Adding them requires the "AnnotateVideo" permission; callers without it
// get a 403 (ApiError.status === 403).

/**
 * Adds a note to a video.
 *
 * Backend route: POST /videos/{video_id}/notes, JSON body { text }.
 */
export async function addVideoNote(videoId: string, text: string): Promise<VideoNote> {
  return apiFetch<VideoNote>(`/videos/${videoId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/**
 * Adds one or more tags to a video.
 *
 * Backend route: POST /videos/{video_id}/tags, JSON body { names }. Names are
 * matched against existing tags case-insensitively (so "blurry" reuses
 * "Blurry"); unknown names are created, and tags the video already has are
 * skipped. Returns ALL tags on the video after the change, sorted by name.
 */
export async function addVideoTags(videoId: string, names: string[]): Promise<VideoTag[]> {
  return apiFetch<VideoTag[]>(`/videos/${videoId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
}

/**
 * Adds a translation (user-defined key + value) to a video.
 *
 * Backend route: POST /videos/{video_id}/translations, JSON body
 * { key, value }. If `key` matches an existing key in any letter-case, the
 * existing spelling is reused (the returned `key` is what was stored).
 * Errors: 409 if this video already has that key.
 */
export async function addVideoTranslation(
  videoId: string,
  key: string,
  value: string
): Promise<Translation> {
  return apiFetch<Translation>(`/videos/${videoId}/translations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

/**
 * Distinct translation keys already in use (case-insensitive), most used
 * first -- offered as suggestions so the same word isn't typed in several
 * spellings.
 *
 * Backend route: GET /videos/translations/keys (optional ?q= substring
 * filter, ?limit=). Requires "AnnotateVideo".
 */
export async function getTranslationKeys(
  params: { q?: string; limit?: number } = {}
): Promise<TranslationKey[]> {
  return apiFetch<TranslationKey[]>(`/videos/translations/keys${toQueryString(params)}`);
}

// ---------------- Videos: submit for annotation ----------------

/** Mirrors the backend's AnnotationJobOut. */
export type AnnotationJob = {
  job_id: string;
  /** Always "Annotation". */
  type: string;
  status: JobStatus;
  video_id: string;
  /** The Record job this video was recorded under. */
  source_job_id: string;
  created_at: string;
  raised_by_user_id: string;
  raised_by_name: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_by_name: string | null;
  assigned_at: string | null;
};

/**
 * Raises an annotation task for one video (one camera angle of a take).
 *
 * Backend route: POST /videos/{video_id}/annotation-jobs, JSON body
 * { assigned_to_user_id? }. Leave `assignedToUserId` out to raise the task
 * unassigned. Requires the "SubmitforAnnotation" permission.
 *
 * Errors worth surfacing:
 *   - 403: caller lacks "SubmitforAnnotation"
 *   - 404: video not found (or the assignee is missing / inactive)
 *   - 409: this video already has a PENDING or PROCESSING annotation job
 *   - 422: the assignee doesn't hold the "AnnotateVideo" permission
 */
export async function submitVideoForAnnotation(
  videoId: string,
  assignedToUserId?: string
): Promise<AnnotationJob> {
  return apiFetch<AnnotationJob>(`/videos/${videoId}/annotation-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignedToUserId ? { assigned_to_user_id: assignedToUserId } : {}),
  });
}

// ---------------- Requested annotations (tasks the current user raised) ----------------
//
// GET /requested-annotations -- annotation tasks raised by the logged-in user
// (via submitVideoForAnnotation), newest first. Only the caller's own
// requests are returned. Requires the "SubmitforAnnotation" permission;
// callers without it get a 403 (ApiError.status === 403).
//
// This backs the "Submitted" page (dashboard/annotations/submitted).

export type RequestedAnnotation = {
  /** The Annotation job. */
  job_id: string;
  status: JobStatus;
  /** When the task was raised. */
  created_at: string;

  video_id: string;
  angle: ViewAngle;
  duration_seconds: number | null;
  resolution: string | null;
  fps: number | null;
  /** Relative API path -- prefix with BASE_URL (see takeVideoUrl). */
  stream_url: string;

  take_id: string;
  take_number: number;
  take_is_valid: boolean;

  transcription_id: string;
  row_number: number | null;
  /** The sentence the video was recorded for. */
  sentence: string;
  /** The Record job the video was recorded under. */
  source_job_id: string;

  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_by_name: string | null;
  assigned_at: string | null;
};

export type RequestedAnnotationsResponse = {
  total: number;
  items: RequestedAnnotation[];
};

export async function listRequestedAnnotations(
  params: {
    status?: JobStatus;
    /** true = only assigned tasks, false = only unassigned tasks. */
    assigned?: boolean;
    /** Case-insensitive substring match on the sentence text. */
    q?: string;
    skip?: number;
    limit?: number;
  } = {}
): Promise<RequestedAnnotationsResponse> {
  return apiFetch<RequestedAnnotationsResponse>(
    `/requested-annotations${toQueryString({
      status: params.status,
      assigned: params.assigned === undefined ? undefined : String(params.assigned),
      q: params.q,
      skip: params.skip,
      limit: params.limit,
    })}`
  );
}

// ---------------- Annotation lists: Assigned (mine) and All (admin roles) ----------------
//
// Same row shape as RequestedAnnotation, plus who raised the task. On the
// Submitted page the raiser is always the caller, so it isn't needed there;
// on the Assigned and All pages it varies from row to row.

export type AnnotationJobListItem = RequestedAnnotation & {
  raised_by_user_id: string;
  raised_by_name: string;
};

export type AnnotationJobListResponse = {
  total: number;
  items: AnnotationJobListItem[];
};

type AnnotationListParams = {
  status?: JobStatus;
  /** Case-insensitive substring match on the sentence text. */
  q?: string;
  skip?: number;
  limit?: number;
};

/**
 * Annotation tasks assigned to the logged-in user, newest first.
 *
 * Backend route (new): GET /assigned-annotations. The backend scopes it to
 * the caller (assigned_to_user_id = current user), so no assignee filter is
 * sent from here. Requires the "SubmitforAnnotation" permission; callers
 * without it get a 403 (ApiError.status === 403).
 */
export async function listMyAssignedAnnotations(
  params: AnnotationListParams = {}
): Promise<AnnotationJobListResponse> {
  return apiFetch<AnnotationJobListResponse>(
    `/assigned-annotations${toQueryString({
      status: params.status,
      q: params.q,
      skip: params.skip,
      limit: params.limit,
    })}`
  );
}

/**
 * Every annotation task raised by any user, newest first.
 *
 * Backend route (new): GET /annotation-jobs. Restrict it on the server to
 * SuperAdmin, Admin and RecorderAdmin (403 otherwise, ApiError.status === 403).
 * `assigned` works like it does in listRequestedAnnotations.
 */
export async function listAllAnnotations(
  params: AnnotationListParams & {
    /** true = only assigned tasks, false = only unassigned tasks. */
    assigned?: boolean;
  } = {}
): Promise<AnnotationJobListResponse> {
  return apiFetch<AnnotationJobListResponse>(
    `/annotation-jobs${toQueryString({
      status: params.status,
      assigned: params.assigned === undefined ? undefined : String(params.assigned),
      q: params.q,
      skip: params.skip,
      limit: params.limit,
    })}`
  );
}

// ---------------- Annotation management (admin roles): annotators, assign, reject ----------------

/** An annotator a task can be assigned to. */
export type Annotator = {
  user_id: string;
  name: string;
  username: string;
  email: string | null;
};

/**
 * Active annotators, sorted by name.
 *
 * Backend route: GET /annotation-jobs/annotators (optional ?search= matching
 * name, username or email). Requires "ListAnnotators"; callers without it get
 * a 403 (ApiError.status === 403).
 */
export async function listAnnotators(
  params: { search?: string } = {}
): Promise<Annotator[]> {
  return apiFetch<Annotator[]>(`/annotation-jobs/annotators${toQueryString(params)}`);
}

/**
 * Assigns (or re-assigns) an open annotation task to an annotator.
 *
 * Backend route: PATCH /annotation-jobs/{job_id}/assign, JSON body
 * { assigned_to_user_id }. Returns the updated row. Requires
 * "ApproveAnnotations" and the SuperAdmin / Admin / RecorderAdmin role.
 *
 * Errors worth surfacing: 404 (task missing, or the user isn't an active
 * annotator), 409 (the task is already COMPLETED or FAILED).
 */
export async function assignAnnotationJob(
  jobId: string,
  assignedToUserId: string
): Promise<AnnotationJobListItem> {
  return apiFetch<AnnotationJobListItem>(`/annotation-jobs/${jobId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigned_to_user_id: assignedToUserId }),
  });
}

/**
 * Rejects a PENDING annotation task.
 *
 * Backend route: PATCH /annotation-jobs/{job_id}/reject. Returns the updated
 * row (a rejected task currently comes back with status FAILED). 409 if the
 * task has already started or finished. Same access as assignAnnotationJob.
 */
export async function rejectAnnotationJob(jobId: string): Promise<AnnotationJobListItem> {
  return apiFetch<AnnotationJobListItem>(`/annotation-jobs/${jobId}/reject`, {
    method: "PATCH",
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