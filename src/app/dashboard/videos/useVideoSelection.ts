"use client";

import { useCallback, useRef, useState } from "react";
import type { VideoFilters } from "@/lib/api";

/** Most videos that can be ticked one by one. Must match MAX_BULK_VIDEOS in videos.py. */
export const MAX_BULK_VIDEOS = 100;

/**
 * "Select all results": instead of a list of ids, the selection is the set of
 * filters the page is showing, and the server works out which videos match.
 * That is what makes a whole Job, or a whole search result, selectable in one
 * click without ticking each video and without the 100-id limit.
 */
export type FilterSelection = { filters: VideoFilters; count: number };

/**
 * Holds the selection. Keep it in the Videos page component (not in a child)
 * so it survives paging through results.
 *
 * Two modes:
 *   - ids      - videos ticked one by one (max MAX_BULK_VIDEOS)
 *   - matching - every video the current filters match (see FilterSelection)
 *
 * `pageIds` are the videos currently visible. If the user unticks one video
 * while "all matching" is on, the selection falls back to the visible videos
 * minus that one (like Gmail's "select all conversations").
 */
export function useVideoSelection(pageIds: string[] = []) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [matching, setMatching] = useState<FilterSelection | null>(null);

  const pageIdsRef = useRef(pageIds);
  pageIdsRef.current = pageIds;
  const matchingRef = useRef(matching);
  matchingRef.current = matching;

  // Any manual change while "all matching" is on first drops back to the ids on this page.
  const edit = useCallback((apply: (next: Set<string>) => void) => {
    const leaving = matchingRef.current !== null;
    if (leaving) setMatching(null);
    setSelected((prev) => {
      const next = leaving ? new Set(pageIdsRef.current.slice(0, MAX_BULK_VIDEOS)) : new Set(prev);
      apply(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (id: string) =>
      edit((next) => {
        if (next.has(id)) next.delete(id);
        else if (next.size < MAX_BULK_VIDEOS) next.add(id);
      }),
    [edit],
  );

  /** Select (on = true) or deselect (on = false) several ids at once, e.g. all angles of a take. */
  const setMany = useCallback(
    (ids: string[], on: boolean) =>
      edit((next) => {
        for (const id of ids) {
          if (!on) next.delete(id);
          else if (next.size < MAX_BULK_VIDEOS) next.add(id);
        }
      }),
    [edit],
  );

  /** Select every video the given filters match (the server resolves them). */
  const selectAllMatching = useCallback((filters: VideoFilters, count: number) => {
    setSelected(new Set());
    setMatching({ filters, count });
  }, []);

  const clearMatching = useCallback(() => setMatching(null), []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setMatching(null);
  }, []);

  const isSelected = useCallback((id: string) => matching !== null || selected.has(id), [selected, matching]);

  /** For a "select all" checkbox over a group of ids. */
  const groupState = useCallback(
    (ids: string[]) => {
      if (matching) return { all: ids.length > 0, some: false };
      const n = ids.filter((id) => selected.has(id)).length;
      return { all: ids.length > 0 && n === ids.length, some: n > 0 && n < ids.length };
    },
    [selected, matching],
  );

  return {
    selected,
    matching,
    /** Ids ticked one by one. Empty while "all matching" is on (use `matching` then). */
    ids: matching ? [] : Array.from(selected),
    /** How many videos are selected, in either mode. */
    count: matching ? matching.count : selected.size,
    atLimit: !matching && selected.size >= MAX_BULK_VIDEOS,
    toggle,
    setMany,
    selectAllMatching,
    clearMatching,
    clear,
    isSelected,
    groupState,
  };
}