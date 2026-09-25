"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./FolderPathSelect.module.css";
import { BASE_URL } from "@/config/api";

export interface FolderOption {
  name: string;
  path: string;
}

interface FolderPathSelectProps {
  label: string;
  // URL segment for this setting, e.g. "raw-files" -> GET/PUT /settings/raw-files
  endpoint: string;
  folders: FolderOption[];
  foldersLoading: boolean;
  foldersError: string | null;
  // Called after a new folder is successfully created on the server, so the
  // parent can add it to the shared folders list used by every dropdown.
  onFolderCreated?: (folder: FolderOption) => void;
}

export default function FolderPathSelect({
  label,
  endpoint,
  folders,
  foldersLoading,
  foldersError,
  onFolderCreated,
}: FolderPathSelectProps) {
  const [currentValue, setCurrentValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [creatingError, setCreatingError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the currently saved path for this setting on mount.
  useEffect(() => {
    let cancelled = false;

    const fetchCurrent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${BASE_URL}/settings/${endpoint}`, {
          credentials: "include",
        });

        if (cancelled) return;

        if (res.status === 404) {
          // Not set yet — leave dropdown on the placeholder.
          setCurrentValue("");
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Request failed (${res.status})`);
        }

        const json = await res.json();
        setCurrentValue(json.value ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load setting");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCurrent();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  const savePath = async (newPath: string) => {
    const previousValue = currentValue;

    setCurrentValue(newPath); // optimistic update
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`${BASE_URL}/settings/${endpoint}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setCurrentValue(previousValue); // revert on failure
      setError(err instanceof Error ? err.message : "Failed to save setting");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await savePath(e.target.value);
  };

  const handleOpenCreate = () => {
    setCreatingError(null);
    setNewFolderName("");
    setCreating(true);
  };

  const handleCancelCreate = () => {
    setCreating(false);
    setNewFolderName("");
    setCreatingError(null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingBusy) return;

    setCreatingBusy(true);
    setCreatingError(null);

    try {
      const res = await fetch(`${BASE_URL}/settings/root-path/folders`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }

      const folder: FolderOption = body;
      onFolderCreated?.(folder);
      setCreating(false);
      setNewFolderName("");
      await savePath(folder.path);
    } catch (err) {
      setCreatingError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreatingBusy(false);
    }
  };

  const handleCreateInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateFolder();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelCreate();
    }
  };

  const disabled = loading || foldersLoading || saving || !!foldersError;

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>

      <div className={styles.controlWrap}>
        {creating ? (
          <div className={styles.createRow}>
            <input
              ref={inputRef}
              type="text"
              className={styles.createInput}
              placeholder="New folder name…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={handleCreateInputKeyDown}
              disabled={creatingBusy}
              spellCheck={false}
            />
            <button
              type="button"
              className={styles.createSaveBtn}
              onClick={handleCreateFolder}
              disabled={creatingBusy || !newFolderName.trim()}
            >
              {creatingBusy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className={styles.createCancelBtn}
              onClick={handleCancelCreate}
              disabled={creatingBusy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className={styles.selectRow}>
            <select
              className={styles.select}
              value={currentValue}
              onChange={handleChange}
              disabled={disabled || folders.length === 0}
            >
              <option value="" disabled>
                {foldersLoading
                  ? "Loading folders…"
                  : folders.length === 0
                    ? "No folders yet"
                    : "Select folder"}
              </option>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.createNewBtn}
              onClick={handleOpenCreate}
              disabled={disabled}
            >
              + New folder
            </button>
          </div>
        )}

        {saving && <span className={styles.status}>Saving…</span>}
        {saved && !saving && <span className={styles.statusSaved}>Saved</span>}
        {(error || foldersError) && !creating && <span className={styles.error}>{error || foldersError}</span>}
        {creatingError && <span className={styles.error}>{creatingError}</span>}
      </div>
    </div>
  );
}