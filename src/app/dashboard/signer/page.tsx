"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import CreateSignerModal, { SignerRecord } from "@/components/CreateSignerModal";
import EditSignerModal from "./EditSignerModal";
import SignerAccordionItem from "./SignerAccordionItem";
import { BASE_URL } from "@/config/api";

const PAGE_SIZE = 20;

type ViewState = "loading" | "ready" | "unauthorized" | "error";

export default function SignersPage() {
  const [signers, setSigners] = useState<SignerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSigner, setEditingSigner] = useState<SignerRecord | null>(null);

  const fetchSigners = useCallback(async (skip: number, searchTerm: string, append: boolean) => {
    if (append) setLoadingMore(true);
    else setViewState("loading");
    setErrorText(null);

    try {
      const params = new URLSearchParams({ skip: String(skip), limit: String(PAGE_SIZE) });
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`${BASE_URL}/signers?${params.toString()}`, {
        credentials: "include",
      });

      if (res.status === 403) {
        setViewState("unauthorized");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }

      const json: { total: number; items: SignerRecord[] } = await res.json();
      setTotal(json.total);
      setSigners((prev) => (append ? [...prev, ...json.items] : json.items));
      setViewState("ready");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to load signers");
      setViewState("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchSigners(0, search, false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, fetchSigners]);

  function handleCreated(signer: SignerRecord) {
    setSigners((prev) => [signer, ...prev]);
    setTotal((t) => t + 1);
    setShowCreateModal(false);
  }

  function handleUpdated(updated: SignerRecord) {
    setSigners((prev) => prev.map((s) => (s.signer_id === updated.signer_id ? updated : s)));
    setEditingSigner(null);
  }

  function handleLoadMore() {
    fetchSigners(signers.length, search, true);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Signers</h2>
        <button type="button" className={styles.addBtn} onClick={() => setShowCreateModal(true)}>
          Add signer
        </button>
      </div>

      <input
        type="text"
        className={styles.searchInput}
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {viewState === "unauthorized" && (
        <p className={styles.stateText}>You don't have permission to view signers.</p>
      )}

      {viewState === "error" && <p className={styles.errorText}>{errorText}</p>}

      {viewState === "loading" && signers.length === 0 && (
        <p className={styles.stateText}>Loading signers…</p>
      )}

      {viewState === "ready" && signers.length === 0 && (
        <p className={styles.stateText}>No signers found.</p>
      )}

      {signers.length > 0 && (
        <div className={styles.list}>
          {signers.map((signer) => (
            <SignerAccordionItem key={signer.signer_id} signer={signer} onEdit={setEditingSigner} />
          ))}
        </div>
      )}

      {signers.length > 0 && signers.length < total && (
        <button type="button" className={styles.loadMoreBtn} onClick={handleLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : `Load more (${signers.length} of ${total})`}
        </button>
      )}

      {showCreateModal && (
        <CreateSignerModal onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      )}

      {editingSigner && (
        <EditSignerModal
          signer={editingSigner}
          onClose={() => setEditingSigner(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}