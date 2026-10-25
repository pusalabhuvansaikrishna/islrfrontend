// src/lib/api/jobProgress.ts
//
// Client for GET /dashboard/job-progress and POST /dashboard/job-progress/email.
// Uses the same BASE_URL and cookie-based session pattern as
// fetchDashboardInsights in src/lib/api/dashboard.ts.

import { BASE_URL } from "@/config/api";
import { DashboardApiError, type JobStatus } from "@/lib/api/dashboard";

export interface JobDailyCompleted {
  date: string; // "YYYY-MM-DD"
  completed: number;
}

export interface JobSignerProgress {
  signer_id: string;
  signer_name: string;
  transcriptions_covered: number;
}

export interface JobProgress {
  job_id: string;
  filename: string;
  status: JobStatus;
  total_transcriptions: number;
  completed_total: number;
  remaining: number;
  signers_still_needed: number;
  signers_count: number;
  completed_per_day: JobDailyCompleted[];
  signers: JobSignerProgress[];
}

export interface JobProgressResponse {
  jobs: JobProgress[];
}

export interface JobProgressParams {
  startDate?: string; // "YYYY-MM-DD", inclusive
  endDate?: string; // "YYYY-MM-DD", inclusive
  jobId?: string;
  tz?: string; // IANA timezone, defaults to the browser's
}

export interface EmailJobProgressParams extends JobProgressParams {
  recipients: string[];
}

export interface EmailJobProgressResponse {
  sent_to: string[];
}

// Browsers may report the legacy alias "Asia/Calcutta"; the current IANA
// name is "Asia/Kolkata", which is safer for Python's zoneinfo on Windows.
function resolveTimeZone(tz?: string): string {
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}

async function toApiError(res: Response, fallback: string): Promise<DashboardApiError> {
  if (res.status === 403) {
    return new DashboardApiError("You don't have permission to do that.", res.status);
  }

  // FastAPI sends { detail: "..." } for 400/502 and a list for 422s.
  let detail: string | null = null;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* ignore non-JSON bodies */
  }

  return new DashboardApiError(detail ?? `${fallback} (${res.status}).`, res.status);
}

export async function fetchJobProgress(
  params: JobProgressParams = {}
): Promise<JobProgressResponse> {
  const query = new URLSearchParams();
  if (params.startDate) query.set("start_date", params.startDate);
  if (params.endDate) query.set("end_date", params.endDate);
  if (params.jobId) query.set("job_id", params.jobId);
  query.set("tz", resolveTimeZone(params.tz));

  // Bodyless GET: no Content-Type header, avoiding a CORS preflight.
  const res = await fetch(`${BASE_URL}/dashboard/job-progress?${query.toString()}`, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) throw await toApiError(res, "Failed to load job progress");
  return res.json();
}

/**
 * Asks the backend to email the job-progress report to `recipients`.
 * Pass the same filters the report on screen was loaded with; the server
 * rebuilds the report itself, so what arrives matches the database.
 */
export async function emailJobProgress(
  params: EmailJobProgressParams
): Promise<EmailJobProgressResponse> {
  const res = await fetch(`${BASE_URL}/dashboard/job-progress/email`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipients: params.recipients,
      start_date: params.startDate ?? null,
      end_date: params.endDate ?? null,
      job_id: params.jobId ?? null,
      tz: resolveTimeZone(params.tz),
    }),
  });

  if (!res.ok) throw await toApiError(res, "Failed to send the report");
  return res.json();
}