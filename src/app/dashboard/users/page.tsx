"use client";

import { useState } from "react";
import styles from "../admins/page.module.css";
import UsersPanel from "./UsersPanel";
import CreateUserModal from "./CreateUserModal";
import RequireRole from "@/components/RequireRole";
import type { UserAccount } from "./types";

export default function UsersPage() {
  const [createOpen, setCreateOpen] = useState(false);
  // Bumping this forces UsersPanel to refetch after a successful create.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleCreated(_user: UserAccount) {
    setCreateOpen(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <RequireRole allowed={["SuperAdmin", "Admin"]}>
      <div className={styles.wrap}>
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.welcomeText}>Users</h2>
            <p className={styles.subtitle}>
              Manage end-user accounts.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setCreateOpen(true)}
          >
            Add user
          </button>
        </div>

        <UsersPanel refreshKey={refreshKey} />

        {createOpen && (
          <CreateUserModal
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </div>
    </RequireRole>
  );
}