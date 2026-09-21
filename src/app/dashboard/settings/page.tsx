"use client";

import { useEffect, useState } from "react";
import RootPathBox from "./RootPathBox";
import FolderPathSelect, { FolderOption } from "./FolderPathSelect";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";

const FOLDER_SETTINGS = [
  { label: "Raw Files", endpoint: "raw-files" },
  { label: "Transcriptions", endpoint: "transcriptions" },
  { label: "Signer Photos", endpoint: "signer-photos" },
  { label: "CSV Files", endpoint: "csv-files" },
];

export default function SettingsPage() {
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchFolders = async () => {
      setFoldersLoading(true);
      setFoldersError(null);
      try {
        const res = await fetch(`${BASE_URL}/settings/root-path/folders`, {
          credentials: "include",
        });

        if (cancelled) return;

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Request failed (${res.status})`);
        }

        const json = await res.json();
        setFolders(json.folders ?? []);
      } catch (err) {
        if (!cancelled) {
          setFoldersError(err instanceof Error ? err.message : "Failed to load folder list");
        }
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    };

    fetchFolders();
    return () => {
      cancelled = true;
    };
  }, []);

  // Called by any FolderPathSelect after it creates a new folder on the
  // server. Adds it to the shared list (deduped by path) so every dropdown
  // sees the new option immediately, without a full refetch.
  const handleFolderCreated = (folder: FolderOption) => {
    setFolders((prev) => {
      if (prev.some((f) => f.path === folder.path)) return prev;
      return [...prev, folder].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    });
  };

  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>Settings</h2>

      <div className={styles.layout}>
        <div className={styles.cardWrap}>
          {FOLDER_SETTINGS.map((setting) => (
            <div className={styles.card} key={setting.endpoint}>
              <FolderPathSelect
                label={setting.label}
                endpoint={setting.endpoint}
                folders={folders}
                foldersLoading={foldersLoading}
                foldersError={foldersError}
                onFolderCreated={handleFolderCreated}
              />
            </div>
          ))}
        </div>

        <div className={styles.sideColumn}>
          <div className={styles.card}>
            <div className={styles.rootPathRow}>
              <span className={styles.label}>Root Path</span>
              <RootPathBox />
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.rootPathRow}>
              <span className={styles.label}>Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}