"use client";

import { useState } from "react";
import styles from "./page.module.css";
import AdminsPanel from "./AdminsPanel";
import CreateAdminModal from "./CreateAdminModal";
import RequireRole from "@/components/RequireRole";
import type { Admin } from "./types";

export default function AdminsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  // Bumping this forces AdminsPanel to refetch after a successful create.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleCreated(_admin: Admin) {
    setCreateOpen(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <RequireRole>
      <div className={styles.wrap}>
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.welcomeText}>Admins</h2>
            <p className={styles.subtitle}>
              Manage who has administrative access to the app.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setCreateOpen(true)}
          >
            Add admin
          </button>
        </div>

        <AdminsPanel refreshKey={refreshKey} />

        {createOpen && (
          <CreateAdminModal
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </div>
    </RequireRole>
  );
}