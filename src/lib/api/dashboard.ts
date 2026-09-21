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

export async function fetchDashboardInsights(): Promise<DashboardInsights> {
  const res = await fetch(`${BASE_URL}/dashboard/insights`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new DashboardApiError(
        "You don't have permission to view this dashboard.",
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