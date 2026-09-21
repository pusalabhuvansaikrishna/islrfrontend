// Location: src/lib/cameraAssignments.ts
// Ported verbatim from the recorder project — no changes needed.
//
// Persists which physical GoPro (by its agent-reported serial/id) is
// assigned to which view angle. Lives in localStorage because the agent
// and browser are always on the same machine — no need for a backend
// round trip, and it means assignments survive refreshes/reconnects
// without ever hitting the network.

export type ViewAngle = "left" | "front" | "right";

export const KNOWN_ANGLES: ViewAngle[] = ["left", "front", "right"];

// angle -> camera id. Not the reverse, so it's trivial to render the
// fixed three-slot grid (same pattern as buildVideoSlots in TakeDetail).
export type AngleAssignments = Partial<Record<ViewAngle, string>>;

const STORAGE_KEY = "gopro-angle-assignments-v1";

export function loadAssignments(): AngleAssignments {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AngleAssignments) : {};
  } catch {
    return {};
  }
}

export function saveAssignments(assignments: AngleAssignments): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — assignment
    // just won't persist across sessions; not fatal for the current one.
  }
}

// Reverse lookup, used to figure out "does this detected camera already
// have an angle?" without the caller re-deriving the map every time.
export function angleForCamera(
  assignments: AngleAssignments,
  cameraId: string
): ViewAngle | null {
  for (const angle of KNOWN_ANGLES) {
    if (assignments[angle] === cameraId) return angle;
  }
  return null;
}