"use client";

import { useState } from "react";
import styles from "../admins/page.module.css";
import EditorsPanel from "./EditorsPanel";
import CreateEditorModal from "./CreateEditorModal";
import RequireRole from "@/components/RequireRole";
import type { Editor } from "./types";

export default function EditorsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  // Bumping this forces EditorsPanel to refetch after a successful create.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleCreated(_editor: Editor) {
    setCreateOpen(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <RequireRole allowed={["SuperAdmin", "Admin"]}>
      <div className={styles.wrap}>
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.welcomeText}>Editors</h2>
            <p className={styles.subtitle}>
              Manage who has content and data capture access to the app.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setCreateOpen(true)}
          >
            Add editor
          </button>
        </div>

        <EditorsPanel refreshKey={refreshKey} />

        {createOpen && (
          <CreateEditorModal
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </div>
    </RequireRole>
  );
}