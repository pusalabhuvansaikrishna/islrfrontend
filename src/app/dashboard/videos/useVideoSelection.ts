"use client";

import { useCallback, useState } from "react";

/** Must match MAX_BULK_VIDEOS in videos.py. */
export const MAX_BULK_VIDEOS = 100;

/**
 * Holds the set of selected video ids. Keep it in the Videos page component
 * (not in a child) so the selection survives paging through results.
 */
export function useVideoSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK_VIDEOS) next.add(id);
      return next;
    });
  }, []);

  /** Select (on = true) or deselect (on = false) several ids at once, e.g. all angles of a take. */
  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (!on) next.delete(id);
        else if (next.size < MAX_BULK_VIDEOS) next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  /** For a "select all" checkbox over a group of ids. */
  const groupState = useCallback(
    (ids: string[]) => {
      const n = ids.filter((id) => selected.has(id)).length;
      return { all: ids.length > 0 && n === ids.length, some: n > 0 && n < ids.length };
    },
    [selected],
  );

  return {
    selected,
    ids: Array.from(selected),
    count: selected.size,
    atLimit: selected.size >= MAX_BULK_VIDEOS,
    toggle,
    setMany,
    clear,
    isSelected,
    groupState,
  };
}
