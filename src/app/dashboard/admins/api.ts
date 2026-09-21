// Thin fetch wrapper for the FastAPI backend, matching the pattern in
// UserContext.tsx: BASE_URL from config, cookie-based session
// (credentials: "include"), no bearer token involved.

import { BASE_URL } from "@/config/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // response wasn't JSON — keep the default message
    }
    throw new ApiError(detail, res.status);
  }

  // 204 No Content etc.
  if (res.status === 204) return undefined as T;
  return res.json();
}