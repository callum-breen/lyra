import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";

import { trpc } from "~/utils/trpc";
import styles from "./CreateBaseModal.module.css";

type CreateBaseModalProps = {
  onClose: () => void;
};

export function CreateBaseModal({ onClose }: CreateBaseModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  const createBase = trpc.base.create.useMutation({
    onSuccess: async (base) => {
      void utils.base.list.invalidate();
      onClose();
      const tables = await utils.table.listByBaseId.fetch({ baseId: base.id });
      if (tables.length > 0) {
        void router.push(`/bases/${base.id}/tables/${tables[0]!.id}`);
      } else {
        void router.push(`/bases/${base.id}`);
      }
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      createBase.mutate({ name: trimmed });
    },
    [name, createBase]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-base-title"
    >
      <div className={styles.modal}>
        <h2 id="create-base-title" className={styles.title}>
          Create base
        </h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="create-base-name" className={styles.label}>
            Base name
          </label>
          <input
            id="create-base-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Project tracker"
            autoFocus
            disabled={createBase.isPending}
          />
          {createBase.isError && (
            <p className={styles.error}>
              {createBase.error.message}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={createBase.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!name.trim() || createBase.isPending}
            >
              {createBase.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
