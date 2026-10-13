export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type StatusFilter = RequestStatus | "ALL";

export type JobRequestRecord = {
  job_request_id: string;
  filename: string;
  row_count: number | null;
  requested_by: string;
  requested_by_email: string | null;
  notes: string | null;
  status: RequestStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_job_id: string | null;
};

export type PreviewRow = {
  row_number: number;
  text: string;
  required_signer_count: number;
};

export type PreviewResponse = {
  filename: string;
  total_rows: number; // every row in the CSV
  total: number; // rows matching the current search
  items: PreviewRow[];
};