import { useState, useCallback, useEffect } from "react";

import { trpc } from "~/utils/trpc";
import styles from "./CreateBaseModal.module.css";

type ColumnForVisibility = { id: string };

type CreateViewModalProps = {
  tableId: string;
  columns: ColumnForVisibility[];
  viewCount: number;
  onClose: () => void;
  onSuccess: (viewId: string) => void;
};

export function CreateViewModal({
  tableId,
  columns,
  viewCount,
  onClose,
  onSuccess,
}: CreateViewModalProps) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  const updateView = trpc.view.update.useMutation({
    onSuccess: () => {
      void utils.view.listByTableId.invalidate({ tableId });
    },
  });

  const createView = trpc.view.create.useMutation({
    onSuccess: async (view) => {
      void utils.view.listByTableId.invalidate({ tableId });
      if (columns.length > 0) {
        await updateView.mutateAsync({
          id: view.id,
          columnVisibility: columns.map((c, i) => ({
            columnId: c.id,
            visible: true,
            position: i,
          })),
        });
      }
      onClose();
      onSuccess(view.id);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      createView.mutate({ tableId, name: trimmed, position: viewCount });
    },
    [tableId, name, createView]
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
      aria-labelledby="create-view-title"
    >
      <div className={styles.modal}>
        <h2 id="create-view-title" className={styles.title}>
          Create view
        </h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="create-view-name" className={styles.label}>
            View name
          </label>
          <input
            id="create-view-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My view"
            autoFocus
            disabled={createView.isPending}
          />
          {createView.isError && (
            <p className={styles.error}>{createView.error.message}</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={createView.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!name.trim() || createView.isPending}
            >
              {createView.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
