"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import Modal from "./Modal";
import {
  Permission,
  RoleWithPermissions,
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  syncRolePermissions,
  updateRole,
} from "./lib/adminApi";

type RoleFormState = { name: string; description: string };
const emptyForm: RoleFormState = { name: "", description: "" };

export default function RolesPanel() {
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formModal, setFormModal] = useState<
    { mode: "create" } | { mode: "edit"; role: RoleWithPermissions } | null
  >(null);
  const [form, setForm] = useState<RoleFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [permModal, setPermModal] = useState<RoleWithPermissions | null>(null);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [permError, setPermError] = useState<string | null>(null);
  const [permSaving, setPermSaving] = useState(false);

  const loadRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRoles();
      setRoles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setFormModal({ mode: "create" });
  };

  const openEdit = (role: RoleWithPermissions) => {
    setForm({ name: role.name, description: role.description ?? "" });
    setFormError(null);
    setFormModal({ mode: "edit", role });
  };

  const submitForm = async () => {
    if (!form.name.trim()) {
      setFormError("Give this role a name.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (formModal?.mode === "edit") {
        await updateRole(formModal.role.role_id, {
          name: form.name.trim(),
          description: form.description.trim(),
        });
      } else {
        await createRole({
          name: form.name.trim(),
          description: form.description.trim(),
        });
      }
      setFormModal(null);
      await loadRoles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save role");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: RoleWithPermissions) => {
    if (!confirm(`Delete the "${role.name}" role? This can't be undone.`)) return;
    try {
      await deleteRole(role.role_id);
      await loadRoles();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete role");
    }
  };

  const openPermissions = async (role: RoleWithPermissions) => {
    setPermModal(role);
    setPermError(null);
    setSelectedIds(new Set(role.permissions.map((p) => p.permission_id)));
    try {
      const perms = await listPermissions();
      setAllPermissions(perms);
    } catch (err) {
      setPermError(
        err instanceof Error ? err.message : "Couldn't load permissions"
      );
    }
  };

  const togglePermission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const savePermissions = async () => {
    if (!permModal) return;
    setPermSaving(true);
    setPermError(null);
    try {
      await syncRolePermissions(permModal.role_id, Array.from(selectedIds));
      setPermModal(null);
      await loadRoles();
    } catch (err) {
      setPermError(
        err instanceof Error ? err.message : "Couldn't save permissions"
      );
    } finally {
      setPermSaving(false);
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          New role
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {loading ? (
        <p className={styles.statusText}>Loading roles…</p>
      ) : roles.length === 0 ? (
        <div className={styles.emptyState}>
          No roles yet. Create one to start assigning permissions.
        </div>
      ) : (
        <div className={styles.grid}>
          {roles.map((role) => (
            <div className={styles.card} key={role.role_id}>
              <div className={styles.cardTop}>
                <h3 className={styles.cardTitle}>{role.name}</h3>
                <span className={styles.badge}>
                  {role.permissions.length}{" "}
                  {role.permissions.length === 1 ? "permission" : "permissions"}
                </span>
              </div>
              <p className={styles.cardDesc}>
                {role.description || "No description yet."}
              </p>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => openPermissions(role)}
                >
                  Manage permissions
                </button>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => openEdit(role)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => handleDelete(role)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit role */}
      {formModal && (
        <Modal
          title={formModal.mode === "edit" ? "Edit role" : "New role"}
          onClose={() => setFormModal(null)}
        >
          {formError && <div className={styles.errorBanner}>{formError}</div>}
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="role-name">
              Name
            </label>
            <input
              id="role-name"
              className={styles.input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Editor"
              autoFocus
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="role-desc">
              Description
            </label>
            <textarea
              id="role-desc"
              className={styles.textarea}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What can this role do?"
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
              {saving ? "Saving…" : "Save role"}
            </button>
          </div>
        </Modal>
      )}

      {/* Manage a role's permissions */}
      {permModal && (
        <Modal
          title={`Permissions for ${permModal.name}`}
          subtitle="Tap a permission to grant or revoke it, then save."
          onClose={() => setPermModal(null)}
          wide
        >
          {permError && <div className={styles.errorBanner}>{permError}</div>}
          {allPermissions.length === 0 ? (
            <p className={styles.statusText}>
              No permissions exist yet — create some in the Permissions tab first.
            </p>
          ) : (
            <div className={styles.chipList}>
              {allPermissions.map((perm) => {
                const active = selectedIds.has(perm.permission_id);
                return (
                  <button
                    key={perm.permission_id}
                    type="button"
                    className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                    onClick={() => togglePermission(perm.permission_id)}
                    title={perm.description ?? undefined}
                  >
                    {perm.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setPermModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={savePermissions}
              disabled={permSaving || allPermissions.length === 0}
            >
              {permSaving ? "Saving…" : "Save permissions"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}