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
  { value: "TEXT", label: "Single line text" },
  { value: "LONG_TEXT", label: "Long text" },
  { value: "NUMBER", label: "Number" },
  { value: "SINGLE_SELECT", label: "Single select" },
];

const OPTION_COLORS = [
  "#fce7f3", "#fef9c3", "#dcfce7", "#dbeafe", "#e5e7eb",
  "#fed7aa", "#e9d5ff", "#fecaca",
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
  const [singleSelectOptions, setSingleSelectOptions] = useState<
    { label: string; color: string }[]
  >([{ label: "", color: OPTION_COLORS[0]! }]);

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
      if (type === "SINGLE_SELECT") {
        const options = singleSelectOptions
          .map((o) => ({ label: o.label.trim(), color: o.color }))
          .filter((o) => o.label.length > 0);
        if (options.length === 0) {
          setNameError("Add at least one option");
          return;
        }
        createColumn.mutate({
          tableId,
          name: trimmed,
          type,
          position,
          options,
        });
      } else {
        createColumn.mutate({ tableId, name: trimmed, type, position });
      }
    },
    [
      tableId,
      name,
      type,
      position,
      existingColumnNames,
      singleSelectOptions,
      createColumn,
    ]
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
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const addOption = useCallback(() => {
    setSingleSelectOptions((prev) => [
      ...prev,
      { label: "", color: OPTION_COLORS[prev.length % OPTION_COLORS.length]! },
    ]);
  }, []);

  const updateOption = useCallback(
    (index: number, updates: { label?: string; color?: string }) => {
      setSingleSelectOptions((prev) =>
        prev.map((o, i) => (i === index ? { ...o, ...updates } : o))
      );
    },
    []
  );

  const removeOption = useCallback((index: number) => {
    setSingleSelectOptions((prev) => prev.filter((_, i) => i !== index));
  }, []);

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
            onChange={(e) => {
              const v = e.target.value as ColumnType;
              setType(v);
              if (v !== "SINGLE_SELECT")
                setSingleSelectOptions([{ label: "", color: OPTION_COLORS[0]! }]);
            }}
            disabled={createColumn.isPending}
          >
            {COLUMN_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {type === "SINGLE_SELECT" && (
            <div className={styles.form}>
              <label className={styles.label}>Options</label>
              {singleSelectOptions.map((opt, i) => (
                <div key={i} className={styles.optionRow}>
                  <input
                    type="text"
                    className={styles.input}
                    value={opt.label}
                    onChange={(e) => updateOption(i, { label: e.target.value })}
                    placeholder="Option name"
                    disabled={createColumn.isPending}
                  />
                  <select
                    className={styles.colorSelect}
                    value={opt.color}
                    onChange={(e) => updateOption(i, { color: e.target.value })}
                    disabled={createColumn.isPending}
                    aria-label="Color"
                  >
                    {OPTION_COLORS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.removeOptionBtn}
                    onClick={() => removeOption(i)}
                    disabled={singleSelectOptions.length <= 1 || createColumn.isPending}
                    aria-label="Remove option"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addOptionBtn}
                onClick={addOption}
                disabled={createColumn.isPending}
              >
                + Add option
              </button>
            </div>
          )}
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
              disabled={
                !name.trim() ||
                createColumn.isPending ||
                (type === "SINGLE_SELECT" &&
                  singleSelectOptions.every((o) => !o.label.trim()))
              }
            >
              {createColumn.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
