export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type StatusFilter = RequestStatus | "ALL";

export type AccountRequestRecord = {
  request_id: string;
  name: string;
  username: string;
  email: string;
  notes: string | null;
  status: RequestStatus;
  created_at: string;
  assigned_role: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

export type PermissionInfo = {
  permission_id: string;
  name: string;
  description: string | null;
};

export type RoleOption = {
  role_id: string;
  name: string;
  description: string | null;
  permissions: PermissionInfo[];
};