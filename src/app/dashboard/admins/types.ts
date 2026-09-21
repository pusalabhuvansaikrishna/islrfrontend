export interface Role {
  role_id: string;
  name: string;
}

// Mirrors UserOut from the backend for admin accounts (role is always "Admin").
export interface Admin {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role?: Role | null;
}

// Mirrors AdminCreateRequest — role is NOT sent, the backend always
// creates the account under the "Admin" role.
export interface CreateAdminPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors PasswordResetRequest — used by the new reset-password endpoint.
export interface ResetPasswordPayload {
  new_password: string;
}

export interface Role {
  role_id: string;
  name: string;
}

// Mirrors UserOut from the backend for admin accounts (role is always "Admin").
export interface Admin {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role?: Role | null;
}

// Mirrors AdminCreateRequest — role is NOT sent, the backend always
// creates the account under the "Admin" role.
export interface CreateAdminPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors AdminUpdate — all fields optional, only changed ones need sending.
export interface UpdateAdminPayload {
  name?: string;
  username?: string;
  email?: string;
}

// Mirrors PasswordResetRequest — used by the new reset-password endpoint.
export interface ResetPasswordPayload {
  new_password: string;
}