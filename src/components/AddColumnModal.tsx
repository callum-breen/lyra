import { useState, useCallback, useEffect } from "react";
import type { ColumnType } from "../../generated/prisma/client";
import { trpc } from "~/utils/trpc";
import styles from "./CreateBaseModal.module.css";

type AddColumnModalProps = {
  tableId: string;
  position: number;
  existingColumnNames: string[];
  onClose: () => void;
  onSuccess?: () => void;
};

const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
];

export function AddColumnModal({
  tableId,
  position,
  existingColumnNames,
  onClose,
  onSuccess,
}: AddColumnModalProps) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("TEXT");
  const [nameError, setNameError] = useState<string | null>(null);

  const createColumn = trpc.column.create.useMutation({
    onSuccess: () => {
      void utils.table.getById.invalidate({ id: tableId });
      onClose();
      onSuccess?.();
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setNameError(null);
      const trimmed = name.trim();
      if (!trimmed) return;
      const isDuplicate = existingColumnNames.some(
        (existing) => existing.toLowerCase() === trimmed.toLowerCase()
      );
      if (isDuplicate) {
        setNameError("Please enter a unique field name");
        return;
      }
      createColumn.mutate({ tableId, name: trimmed, type, position });
    },
    [tableId, name, type, position, existingColumnNames, createColumn]
  );

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setNameError(null);
  }, []);

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
      aria-labelledby="add-column-title"
    >
      <div className={styles.modal}>
        <h2 id="add-column-title" className={styles.title}>
          Add column
        </h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="add-column-name" className={styles.label}>
            Column name
          </label>
          <input
            id="add-column-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={handleNameChange}
            placeholder="e.g. Priority"
            autoFocus
            disabled={createColumn.isPending}
          />
          <label htmlFor="add-column-type" className={styles.label}>
            Type
          </label>
          <select
            id="add-column-type"
            className={styles.input}
            value={type}
            onChange={(e) => setType(e.target.value as ColumnType)}
            disabled={createColumn.isPending}
          >
            {COLUMN_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {(nameError || createColumn.isError) && (
            <p className={styles.error}>{nameError ?? createColumn.error?.message}</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={createColumn.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!name.trim() || createColumn.isPending}
            >
              {createColumn.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
