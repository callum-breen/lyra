import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useRef, useMemo, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { trpc } from "~/utils/trpc";
import styles from "~/pages/index.module.css";
import gridStyles from "./table-grid.module.css";

const ROW_HEIGHT = 36;
const PAGE_SIZE = 100;

function getCellValue(
  row: { cells: Array<{ columnId: string; textValue: string | null; numberValue: number | null }> },
  columnId: string
): string {
  const cell = row.cells.find((c) => c.columnId === columnId);
  if (!cell) return "";
  if (cell.textValue != null && cell.textValue !== "") return cell.textValue;
  if (cell.numberValue != null) return String(cell.numberValue);
  return "";
}

function getQueryString(
  q: string | string[] | undefined
): string | undefined {
  if (q == null) return undefined;
  const s = Array.isArray(q) ? q[0] : q;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : undefined;
}

export default function TableGridPage() {
  const router = useRouter();
  const baseId = router.query.baseId as string | undefined;
  const tableId = router.query.tableId as string | undefined;
  const urlSearch = getQueryString(router.query.search);
  const urlStatus = getQueryString(router.query.status);
  const parentRef = useRef<HTMLDivElement>(null);

  const { data: table, status: tableStatus } = trpc.table.getById.useQuery(
    { id: tableId! },
    { enabled: !!tableId }
  );

  const listInput = useMemo(() => {
    if (!tableId) return undefined;
    const statusColumn = table?.columns?.find(
      (c) => c.name.toLowerCase() === "status"
    );
    return {
      tableId,
      limit: PAGE_SIZE,
      searchQuery: urlSearch ?? undefined,
      filter:
        urlStatus && statusColumn
          ? {
              columnId: statusColumn.id,
              operator: "EQUALS" as const,
              value: urlStatus,
            }
          : undefined,
    };
  }, [tableId, urlSearch, urlStatus, table?.columns]);

  const utils = trpc.useUtils();
  const {
    data: rowPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status: rowsStatus,
    isError: rowsError,
    refetch: refetchRows,
  } = trpc.row.listByTableId.useInfiniteQuery(listInput!, {
    enabled: !!listInput,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Keep UI/server in sync after row mutations: invalidate cache and refetch this table's rows.
  const syncRowsAfterMutation = useCallback(() => {
    if (listInput) {
      void utils.row.listByTableId.invalidate(listInput);
      void refetchRows();
    }
  }, [listInput, utils, refetchRows]);

  const createRow = trpc.row.create.useMutation({
    onSuccess: syncRowsAfterMutation,
  });
  const updateCell = trpc.row.updateCell.useMutation({
    onSuccess: syncRowsAfterMutation,
  });
  const deleteRow = trpc.row.delete.useMutation({
    onSuccess: syncRowsAfterMutation,
  });

  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const previousCellValueRef = useRef<string>("");

  const infiniteQueryInput = listInput;

  const setUrlFilters = useCallback(
    (updates: { search?: string; status?: string }) => {
      const query = { ...router.query } as Record<string, string | string[] | undefined>;
      if ("search" in updates) {
        if (updates.search) query.search = updates.search;
        else delete query.search;
      }
      if ("status" in updates) {
        if (updates.status) query.status = updates.status;
        else delete query.status;
      }
      void router.push({ pathname: router.pathname, query }, undefined, {
        shallow: true,
      });
    },
    [router]
  );

  const startEditing = useCallback(
    (rowId: string, columnId: string, current: string) => {
      setEditingCell({ rowId, columnId });
      setDraftValue(current);
      previousCellValueRef.current = current;
    },
    []
  );
  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setDraftValue("");
  }, []);

  const applyCellToCache = useCallback(
    (
      rowId: string,
      columnId: string,
      _columnType: string,
      value: string,
      isNumber: boolean
    ) => {
      if (!infiniteQueryInput) return;
      const textVal = isNumber ? null : (value.trim() || null);
      const numVal =
        isNumber ? (value.trim() === "" ? null : Number(value)) : null;
      utils.row.listByTableId.setInfiniteData(infiniteQueryInput, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            rows: page.rows.map((row) => {
              if (row.id !== rowId) return row;
              const hasCell = row.cells.some((c) => c.columnId === columnId);
              if (!hasCell) return row;
              const cells = row.cells.map((c) =>
                c.columnId === columnId
                  ? { ...c, textValue: textVal, numberValue: numVal }
                  : c
              );
              return { ...row, cells };
            }),
          })),
        };
      });
    },
    [utils, infiniteQueryInput]
  );

  const saveCell = useCallback(
    (rowId: string, columnId: string, columnType: string) => {
      if (!editingCell || editingCell.rowId !== rowId || editingCell.columnId !== columnId) return;
      const isNumber = columnType === "NUMBER";
      if (isNumber) {
        const n = draftValue.trim() === "" ? null : Number(draftValue);
        if (n !== null && !Number.isFinite(n)) {
          cancelEditing();
          return;
        }
      }
      const previousValue = previousCellValueRef.current;
      applyCellToCache(rowId, columnId, columnType, draftValue, isNumber);
      cancelEditing();
      const rollback = () => {
        applyCellToCache(rowId, columnId, columnType, previousValue, isNumber);
      };
      if (isNumber) {
        updateCell.mutate(
          { rowId, columnId, numberValue: draftValue.trim() === "" ? undefined : Number(draftValue) },
          { onError: rollback }
        );
      } else {
        updateCell.mutate(
          { rowId, columnId, textValue: draftValue.trim() || null },
          { onError: rollback }
        );
      }
    },
    [editingCell, draftValue, updateCell, cancelEditing, applyCellToCache]
  );

  const rows = useMemo(
    () => rowPages?.pages.flatMap((p) => p.rows) ?? [],
    [rowPages]
  );
  const columns = table?.columns ?? [];
  const totalHeight = rows.length * ROW_HEIGHT;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Fetch more when user scrolls near the end
  const lastItem = virtualRows[virtualRows.length - 1];
  if (lastItem && lastItem.index >= rows.length - 5 && hasNextPage && !isFetchingNextPage) {
    void fetchNextPage();
  }

  if (!baseId || !tableId) return null;

  if (tableStatus === "pending" || (tableStatus === "success" && !table)) {
    return (
      <>
        <Head>
          <title>Table – Airtable</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.container}>
            <p className={styles.showcaseText}>Loading table…</p>
          </div>
        </main>
      </>
    );
  }

  if (tableStatus === "error") {
    return (
      <>
        <Head>
          <title>Table – Airtable</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.container}>
            <p className={styles.showcaseText}>Table not found.</p>
            <Link href={`/bases/${baseId}`} className={styles.loginButton}>
              Back to base
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{table.name} – Airtable</title>
      </Head>
      <main className={styles.main}>
        <div className={styles.container}>
          <div className={gridStyles.gridLayout}>
            <Link
              href={`/bases/${baseId}`}
              className={styles.showcaseText}
              style={{ marginBottom: "0.5rem" }}
            >
              ← {table.base.name}
            </Link>
            <h1 className={styles.title} style={{ marginBottom: "1rem" }}>
              {table.name}
            </h1>

            <div className={gridStyles.filterBar}>
              <input
                type="search"
                className={gridStyles.filterInput}
                placeholder="Search rows…"
                value={urlSearch ?? ""}
                onChange={(e) => setUrlFilters({ search: e.target.value || undefined })}
                aria-label="Search"
              />
              {table.columns.some((c) => c.name.toLowerCase() === "status") && (
                <input
                  type="text"
                  className={gridStyles.filterInput}
                  placeholder="Status"
                  value={urlStatus ?? ""}
                  onChange={(e) => setUrlFilters({ status: e.target.value || undefined })}
                  aria-label="Filter by status"
                />
              )}
            </div>

            {rowsStatus === "pending" ? (
              <p className={styles.showcaseText}>Loading rows…</p>
            ) : rowsError ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
                <p className={styles.showcaseText}>Failed to load rows.</p>
                <button
                  type="button"
                  className={styles.loginButton}
                  onClick={() => void refetchRows()}
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
                  <button
                    type="button"
                    className={styles.loginButton}
                    disabled={createRow.isPending}
                    onClick={() => createRow.mutate({ tableId: tableId! })}
                  >
                    {createRow.isPending ? "Adding…" : "Add row"}
                  </button>
                </div>
                <div
                  ref={parentRef}
                  className={gridStyles.gridScroll}
                  role="grid"
                  aria-label={table.name}
                >
                  <div
                    className={gridStyles.gridHeader}
                    style={{
                      display: "grid",
                      gridTemplateColumns: `minmax(80px, 80px) ${columns.map(() => "minmax(120px, 1fr)").join(" ")}`,
                    }}
                  >
                    <div className={gridStyles.cellHeader} />
                    {columns.map((col) => (
                      <div key={col.id} className={gridStyles.cellHeader}>
                        {col.name}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      height: `${totalHeight}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {virtualRows.map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={row.id}
                          className={gridStyles.gridRow}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                            display: "grid",
                            gridTemplateColumns: `minmax(80px, 80px) ${columns.map(() => "minmax(120px, 1fr)").join(" ")}`,
                          }}
                        >
                          <div className={gridStyles.cellIndex}>
                            <span>{virtualRow.index + 1}</span>
                            <button
                              type="button"
                              className={gridStyles.deleteRowBtn}
                              title="Delete row"
                              disabled={deleteRow.isPending}
                              onClick={() => deleteRow.mutate({ id: row.id })}
                            >
                              ×
                            </button>
                          </div>
                          {columns.map((col) => {
                            const isEditing =
                              editingCell?.rowId === row.id && editingCell?.columnId === col.id;
                            const displayValue = getCellValue(row, col.id);
                            return (
                              <div
                                key={col.id}
                                className={gridStyles.cell}
                                onClick={() => !isEditing && startEditing(row.id, col.id, displayValue)}
                              >
                                {isEditing ? (
                                  <input
                                    type={col.type === "NUMBER" ? "number" : "text"}
                                    className={gridStyles.cellInput}
                                    value={draftValue}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onBlur={() => saveCell(row.id, col.id, col.type)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveCell(row.id, col.id, col.type);
                                      if (e.key === "Escape") cancelEditing();
                                    }}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  displayValue
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {isFetchingNextPage && (
                    <div className={gridStyles.loadingMore}>Loading more…</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
