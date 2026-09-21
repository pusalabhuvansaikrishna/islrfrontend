// Mirrors UserOut from the backend for the general /users endpoints.
// This page is scoped to accounts with the "User" role only — unlike
// Editors/Admins, there's no role field shown here since every row is
// the same role by construction (GET /users defaults to role=User).
export interface UserAccount {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
}

// Mirrors UserCreate — role is NOT sent, the backend always creates
// the account under the "User" role.
export interface CreateUserPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors UserUpdate — all fields optional, only changed ones need sending.
export interface UpdateUserPayload {
  name?: string;
  username?: string;
  email?: string;
}

// Mirrors UserPasswordReset — used by /users/{id}/reset-password.
export interface ResetUserPasswordPayload {
  new_password: string;
}