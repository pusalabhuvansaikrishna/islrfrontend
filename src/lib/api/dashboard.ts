// ---------------------------------------------------------------------
// Types mirror routers/dashboard.py's DashboardInsightsOut exactly.
// ---------------------------------------------------------------------

import { BASE_URL } from "@/config/api";

export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface JobStatusCount {
  status: JobStatus;
  count: number;
}

export interface JobSummary {
  job_id: string;
  filename: string;
  status: JobStatus;
  total_transcriptions: number;
  total_sessions: number;
}

export interface SignerMonthlySessions {
  year: number;
  month: number; // 1-12
  session_count: number;
}

export interface SignerInsight {
  signer_id: string;
  signer_name: string;
  sessions_count: number;
  takes_count: number;
  valid_takes_count: number;
  valid_take_ratio: number; // 0-1
  transcriptions_covered: number;
  sessions_per_month: SignerMonthlySessions[];
}

export interface StorageInsight {
  raw_files_directory: string | null;
  total_bytes: number;
  total_size_display: string;
  file_count: number;
}

export interface DashboardInsights {
  jobs_per_status: JobStatusCount[];
  jobs: JobSummary[];
  signers: SignerInsight[];
  avg_sentences_per_session: number;
  avg_takes_to_valid: number;
  total_sentences: number;
  total_videos: number;
  storage: StorageInsight;
}

/**
 * Optional date filter. Both values are calendar dates in "YYYY-MM-DD"
 * form and both are inclusive. Pass the same date for startDate and
 * endDate to get a single day. Omit both for all-time.
 */
export interface DashboardInsightsParams {
  startDate?: string;
  endDate?: string;
}

// ---------------------------------------------------------------------
// Matches the cookie-based session pattern used in lib/auth.ts
// (getCurrentUser / logout) -- credentials: "include" sends the session
// cookie, no Authorization header needed. BASE_URL comes from the
// project's existing src/config/api.ts so this always points at the
// same backend origin as the rest of the app.
// ---------------------------------------------------------------------

export class DashboardApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}

export async function fetchDashboardInsights(
  params: DashboardInsightsParams = {}
): Promise<DashboardInsights> {
  const query = new URLSearchParams();
  if (params.startDate) query.set("start_date", params.startDate);
  if (params.endDate) query.set("end_date", params.endDate);
  const qs = query.toString();

  // No Content-Type header: this is a bodyless GET, and leaving it off
  // avoids an unnecessary CORS preflight.
  const res = await fetch(`${BASE_URL}/dashboard/insights${qs ? `?${qs}` : ""}`, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new DashboardApiError(
        "You don't have permission to view this dashboard.",
        res.status
      );
    }
    if (res.status === 400 || res.status === 422) {
      // FastAPI sends { detail: "..." } for 400s and a list for 422s.
      let detail: string | null = null;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* ignore non-JSON bodies */
      }
      throw new DashboardApiError(
        detail ?? "That date range isn't valid. Please check the dates and try again.",
        res.status
      );
    }
    throw new DashboardApiError(
      `Failed to load dashboard insights (${res.status}).`,
      res.status
    );
  }

  return res.json();
}