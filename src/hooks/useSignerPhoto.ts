"use client";

import { useEffect, useState } from "react";
import { BASE_URL } from "@/config/api";

/**
 * Fetches a signer's photo through the authenticated API (not a bare <img
 * src>), so it works regardless of whether auth is cookie- or header-based.
 * Returns null (and failed=true) if the signer has no photo, the request
 * fails, or the file is missing on disk — callers should fall back to
 * initials in that case.
 */
export function useSignerPhoto(signerId: string, hasPhoto: boolean) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hasPhoto) {
      setPhotoUrl(null);
      setFailed(false);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);

    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/signers/${signerId}/photo`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Photo request failed (${res.status})`);

        const blob = await res.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [signerId, hasPhoto]);

  return { photoUrl, failed };
}