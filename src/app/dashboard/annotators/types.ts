import type { Role } from "../admins/types";

// Mirrors AnnotatorOut from the backend for annotator accounts (role is always "Annotator").
export interface Annotator {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role?: Role | null;
}

// Mirrors AnnotatorCreate — role is NOT sent, the backend always
// creates the account under the "Annotator" role.
export interface CreateAnnotatorPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors AnnotatorUpdate — all fields optional, only changed ones need sending.
export interface UpdateAnnotatorPayload {
  name?: string;
  username?: string;
  email?: string;
}

// Mirrors AnnotatorPasswordReset — used by the reset-password endpoint.
export interface ResetPasswordPayload {
  new_password: string;
}
