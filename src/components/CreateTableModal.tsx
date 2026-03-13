import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";

import { trpc } from "~/utils/trpc";
import styles from "./CreateBaseModal.module.css";

type CreateTableModalProps = {
  baseId: string;
  onClose: () => void;
};

export function CreateTableModal({ baseId, onClose }: CreateTableModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  const createTable = trpc.table.create.useMutation({
    onSuccess: (table) => {
      void utils.table.listByBaseId.invalidate({ baseId });
      void utils.base.getById.invalidate({ id: baseId });
      onClose();
      void router.push(`/bases/${baseId}/tables/${table.id}`);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      createTable.mutate({ baseId, name: trimmed });
    },
    [baseId, name, createTable]
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
      aria-labelledby="create-table-title"
    >
      <div className={styles.modal}>
        <h2 id="create-table-title" className={styles.title}>
          Create table
        </h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="create-table-name" className={styles.label}>
            Table name
          </label>
          <input
            id="create-table-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tasks"
            autoFocus
            disabled={createTable.isPending}
          />
          {createTable.isError && (
            <p className={styles.error}>{createTable.error.message}</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={createTable.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!name.trim() || createTable.isPending}
            >
              {createTable.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
