/**
 * Bulk ZIP download.
 *
 *   1. POST /videos/download-zip/ticket  (authenticated, returns a short-lived link)
 *   2. Point the browser at that link; it streams the ZIP to disk natively,
 *      so nothing is buffered in JS memory.
 *
 * `request` is YOUR authenticated fetch helper from lib/api.ts. It must take a
 * path relative to the API base and return the fetch Response. If your helper
 * already throws on non-2xx responses, the try/catch in BulkDownloadBar shows
 * its message and the `!res.ok` branch below is simply never reached.
 */
export type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;

export async function downloadVideosZip(
  videoIds: string[],
  request: RequestFn,
  apiBaseUrl: string,
): Promise<void> {
  const res = await request("/videos/download-zip/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_ids: videoIds }),
  });

  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }

  const { download_url } = (await res.json()) as { download_url: string };

  // A temporary link click: the response is "Content-Disposition: attachment",
  // so the browser downloads it without leaving the page.
  const a = document.createElement("a");
  a.href = `${apiBaseUrl.replace(/\/$/, "")}${download_url}`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
