"use client";

import { useState } from "react";
import styles from "../admins/page.module.css";
import AnnotatorsPanel from "./AnnotatorsPanel";
import CreateAnnotatorModal from "./CreateAnnotatorModal";
import RequireRole from "@/components/RequireRole";
import type { Annotator } from "./types";

export default function AnnotatorsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  // Bumping this forces AnnotatorsPanel to refetch after a successful create.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleCreated(_annotator: Annotator) {
    setCreateOpen(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <RequireRole allowed={["SuperAdmin", "Admin"]}>
      <div className={styles.wrap}>
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.welcomeText}>Annotators</h2>
            <p className={styles.subtitle}>
              Manage who has content and data capture access to the app.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setCreateOpen(true)}
          >
            Add annotator
          </button>
        </div>

        <AnnotatorsPanel refreshKey={refreshKey} />

        {createOpen && (
          <CreateAnnotatorModal
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </div>
    </RequireRole>
  );
}
