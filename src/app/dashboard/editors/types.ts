import type { Role } from "../admins/types";

// Mirrors UserOut from the backend for editor accounts (role is always "Editor").
export interface Editor {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role?: Role | null;
}

// Mirrors EditorCreateRequest — role is NOT sent, the backend always
// creates the account under the "Editor" role.
export interface CreateEditorPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors EditorUpdate — all fields optional, only changed ones need sending.
export interface UpdateEditorPayload {
  name?: string;
  username?: string;
  email?: string;
}

// Mirrors PasswordResetRequest — used by the reset-password endpoint.
export interface ResetPasswordPayload {
  new_password: string;
}