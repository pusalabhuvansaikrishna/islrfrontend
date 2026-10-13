"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";
import { RecorderFormModal, ResetPasswordModal, errorFrom } from "./RecorderModals";
import type { RecorderRecord } from "./types";

type ViewState = "loading" | "ready" | "unauthorized" | "error";
type ModalState =
  | { kind: "create" }
  | { kind: "edit"; recorder: RecorderRecord }
  | { kind: "password"; recorder: RecorderRecord }
  | null;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function RecordersPage() {
  const [recorders, setRecorders] = useState<RecorderRecord[]>([]);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setViewState("loading");
    setErrorText(null);
    try {
      const res = await fetch(`${BASE_URL}/recorders`, { credentials: "include" });

      if (res.status === 403) {
        setViewState("unauthorized");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(errorFrom(body?.detail, `Request failed (${res.status})`));
      }

      setRecorders(await res.json());
      setViewState("ready");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to load recorders");
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The endpoint returns every recorder, so searching is done here.
  const term = search.trim().toLowerCase();
  const visible = term
    ? recorders.filter((r) =>
        [r.name, r.username, r.email ?? ""].some((v) => v.toLowerCase().includes(term))
      )
    : recorders;

  function handleSaved(saved: RecorderRecord) {
    setRecorders((prev) =>
      prev.some((r) => r.user_id === saved.user_id)
        ? prev.map((r) => (r.user_id === saved.user_id ? saved : r))
        : [saved, ...prev]
    );
    setModal(null);
  }

  async function toggleActive(r: RecorderRecord) {
    setActionError("");
    setBusyId(r.user_id);
    try {
      const res = await fetch(`${BASE_URL}/recorders/${r.user_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: !r.is_active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(errorFrom(data?.detail, "Couldn't update the account."));
        return;
      }
      setRecorders((prev) => prev.map((x) => (x.user_id === r.user_id ? (data as RecorderRecord) : x)));
    } catch {
      setActionError("Unable to connect to the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>Recorders</h2>
          {viewState === "ready" && (
            <span className={styles.count}>
              {recorders.length} {recorders.length === 1 ? "account" : "accounts"}
            </span>
          )}
        </div>
        {viewState !== "unauthorized" && (
          <button type="button" className={styles.addBtn} onClick={() => setModal({ kind: "create" })}>
            Add recorder
          </button>
        )}
      </div>

      <input
        type="text"
        className={styles.searchInput}
        placeholder="Search by name, username or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search recorders"
      />

      {actionError && <p className={styles.banner}>{actionError}</p>}

      {viewState === "unauthorized" && (
        <p className={styles.stateText}>You don&apos;t have permission to manage recorders.</p>
      )}
      {viewState === "error" && <p className={styles.errorText}>{errorText}</p>}
      {viewState === "loading" && <p className={styles.stateText}>Loading recorders…</p>}
      {viewState === "ready" && visible.length === 0 && (
        <p className={styles.stateText}>
          {term ? "No recorders match your search." : "No recorders yet. Use “Add recorder” to create one."}
        </p>
      )}

      {visible.length > 0 && (
        <div className={styles.list}>
          {visible.map((r) => (
            <div key={r.user_id} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.name}>{r.name}</span>
                <span className={styles.sub}>
                  @{r.username}
                  {r.email ? ` · ${r.email}` : ""}
                </span>
              </div>

              <div className={styles.meta}>
                <span className={`${styles.badge} ${r.is_active ? styles.badgeActive : styles.badgeInactive}`}>
                  {r.is_active ? "Active" : "Inactive"}
                </span>
                <span className={styles.date}>Added {formatDate(r.created_at)}</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setModal({ kind: "edit", recorder: r })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setModal({ kind: "password", recorder: r })}
                >
                  Reset password
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${r.is_active ? styles.dangerAction : ""}`}
                  onClick={() => toggleActive(r)}
                  disabled={busyId === r.user_id}
                >
                  {busyId === r.user_id ? "Saving…" : r.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.kind === "create" && (
        <RecorderFormModal mode="create" onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.kind === "edit" && (
        <RecorderFormModal
          mode="edit"
          recorder={modal.recorder}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.kind === "password" && (
        <ResetPasswordModal recorder={modal.recorder} onClose={() => setModal(null)} />
      )}
    </div>
  );
}