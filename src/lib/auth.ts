import { BASE_URL } from "@/config/api";

export type CurrentUser = {
  user_id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
};

/**
 * Fetches the logged-in user from the backend. If the access token has
 * expired, transparently tries /refresh once and retries — mirroring the
 * access+refresh flow the backend implements. Returns null if the user
 * isn't authenticated (caller should redirect to the login page).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const meResponse = await fetch(`${BASE_URL}/me`, {
    credentials: "include",
  });

  if (meResponse.ok) {
    return meResponse.json();
  }

  if (meResponse.status !== 401) {
    // Something other than "not authenticated" — don't mask it as a login issue.
    return null;
  }

  // Access token likely expired. Try to silently refresh, then retry once.
  const refreshResponse = await fetch(`${BASE_URL}/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (!refreshResponse.ok) {
    return null;
  }

  const retryResponse = await fetch(`${BASE_URL}/me`, {
    credentials: "include",
  });

  return retryResponse.ok ? retryResponse.json() : null;
}

/**
 * Logs out on the backend (clears the httpOnly cookies) and clears the
 * client-side session marker used by middleware.ts.
 */
export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/logout`, {
    method: "POST",
    credentials: "include",
  });

  document.cookie = "has_session=; path=/; max-age=0; SameSite=Lax";
}