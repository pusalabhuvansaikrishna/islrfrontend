"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import Modal from "./Modal";
import {
  Permission,
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
} from "./lib/adminApi";

type PermissionFormState = { name: string; description: string };
const emptyForm: PermissionFormState = { name: "", description: "" };

export default function PermissionsPanel() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formModal, setFormModal] = useState<
    { mode: "create" } | { mode: "edit"; permission: Permission } | null
  >(null);
  const [form, setForm] = useState<PermissionFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPermissions();
      setPermissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load permissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setFormModal({ mode: "create" });
  };

  const openEdit = (permission: Permission) => {
    setForm({ name: permission.name, description: permission.description ?? "" });
    setFormError(null);
    setFormModal({ mode: "edit", permission });
  };

  const submitForm = async () => {
    if (!form.name.trim()) {
      setFormError("Give this permission a name.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (formModal?.mode === "edit") {
        await updatePermission(formModal.permission.permission_id, {
          name: form.name.trim(),
          description: form.description.trim(),
        });
      } else {
        await createPermission({
          name: form.name.trim(),
          description: form.description.trim(),
        });
      }
      setFormModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save permission");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (permission: Permission) => {
    if (
      !confirm(
        `Delete "${permission.name}"? It will be removed from every role that has it.`
      )
    )
      return;
    try {
      await deletePermission(permission.permission_id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete permission");
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          New permission
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {loading ? (
        <p className={styles.statusText}>Loading permissions…</p>
      ) : permissions.length === 0 ? (
        <div className={styles.emptyState}>
          No permissions yet. Create one, then assign it to a role.
        </div>
      ) : (
        <div className={styles.grid}>
          {permissions.map((permission) => (
            <div className={styles.card} key={permission.permission_id}>
              <h3 className={styles.cardTitle}>{permission.name}</h3>
              <p className={styles.cardDesc}>
                {permission.description || "No description yet."}
              </p>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => openEdit(permission)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => handleDelete(permission)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formModal && (
        <Modal
          title={formModal.mode === "edit" ? "Edit permission" : "New permission"}
          onClose={() => setFormModal(null)}
        >
          {formError && <div className={styles.errorBanner}>{formError}</div>}
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="perm-name">
              Name
            </label>
            <input
              id="perm-name"
              className={styles.input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. videos.delete"
              autoFocus
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="perm-desc">
              Description
            </label>
            <textarea
              id="perm-desc"
              className={styles.textarea}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does this permission allow?"
            />
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setFormModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={submitForm}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save permission"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}