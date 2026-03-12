import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useRef, useMemo, useState, useCallback, useEffect, type ChangeEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { useSession } from "next-auth/react";

import { AddColumnModal } from "~/components/AddColumnModal";
import { CreateTableModal } from "~/components/CreateTableModal";
import { CreateViewModal } from "~/components/CreateViewModal";
import { ProfileDropdown } from "~/components/ProfileDropdown";
import { AppLayout } from "~/components/AppLayout";
import { trpc } from "~/utils/trpc";
import s from "./table-grid.module.css";

const ROW_HEIGHT = 32;
const PAGE_SIZE = 200;

const TEXT_FILTER_OPERATORS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "IS_EMPTY", label: "is empty", needsValue: false },
  { value: "IS_NOT_EMPTY", label: "is not empty", needsValue: false },
  { value: "EQUALS", label: "equals", needsValue: true },
  { value: "CONTAINS", label: "contains", needsValue: true },
  { value: "NOT_CONTAINS", label: "does not contain", needsValue: true },
];

const NUMBER_FILTER_OPERATORS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "IS_EMPTY", label: "is empty", needsValue: false },
  { value: "IS_NOT_EMPTY", label: "is not empty", needsValue: false },
  { value: "EQUALS", label: "equals", needsValue: true },
  { value: "GREATER_THAN", label: "is greater than", needsValue: true },
  { value: "LESS_THAN", label: "is less than", needsValue: true },
];

const BASE_COLORS: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  orangeDusty: "#d97706",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#2563eb",
  purple: "#7c3aed",
  pink: "#ec4899",
};

function getBaseColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = Object.values(BASE_COLORS);
  return colors[Math.abs(hash) % colors.length]!;
}

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
  const val = Array.isArray(q) ? q[0] : q;
  return typeof val === "string" && val.trim() !== "" ? val.trim() : undefined;
}

export default function TableGridPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const baseId = router.query.baseId as string | undefined;
  const tableId = router.query.tableId as string | undefined;
  const viewId = typeof router.query.view === "string" ? router.query.view : undefined;
  const urlSearch = getQueryString(router.query.search);
  const urlStatus = getQueryString(router.query.status);
  const parentRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLSpanElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewSearchQuery, setViewSearchQuery] = useState("");

  useEffect(() => {
    if (baseId && tableId) {
      try { localStorage.setItem(`lyra:lastTable:${baseId}`, tableId); } catch {}
    }
  }, [baseId, tableId]);

  const { data: table, status: tableStatus } = trpc.table.getById.useQuery(
    { id: tableId! },
    { enabled: !!tableId }
  );

  const { data: allTables = [] } = trpc.table.listByBaseId.useQuery(
    { baseId: baseId! },
    { enabled: !!baseId && tableStatus === "success" }
  );

  const { data: views = [] } = trpc.view.listByTableId.useQuery(
    { tableId: tableId! },
    { enabled: !!tableId && tableStatus === "success" }
  );

  const [sortOverride, setSortOverride] = useState<
    { columnId: string; direction: "asc" | "desc" } | null
  >(null);

  const activeView = useMemo(() => {
    if (viewId) {
      const v = views.find((x) => x.id === viewId);
      if (v) return v;
    }
    return views[0] ?? null;
  }, [views, viewId]);

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const listInput = useMemo(() => {
    if (!tableId) return undefined;
    const statusColumn = table?.columns?.find(
      (c) => c.name.toLowerCase() === "status"
    );
    const searchQuery =
      debouncedSearch.trim()
        ? debouncedSearch.trim()
        : urlSearch !== undefined
          ? (urlSearch || undefined)
          : undefined;
    let filter:
      | { columnId: string; operator: "EQUALS" | "CONTAINS" | "IS_EMPTY" | "IS_NOT_EMPTY" | "NOT_CONTAINS" | "GREATER_THAN" | "LESS_THAN"; value?: string | null }
      | undefined;
    if (activeView?.filters?.[0]) {
      const f = activeView.filters[0];
      filter = {
        columnId: f.columnId,
        operator: f.operator,
        value: f.value ?? undefined,
      };
    } else if (!activeView && urlStatus && statusColumn) {
      filter = {
        columnId: statusColumn.id,
        operator: "EQUALS" as const,
        value: urlStatus,
      };
    }
    const sortFromView = activeView?.sorts?.[0]
      ? {
          direction: activeView.sorts[0].direction.toLowerCase() as "asc" | "desc",
          columnId: activeView.sorts[0].columnId,
        }
      : undefined;
    // Use view's sort when a view is active; otherwise use toolbar override (e.g. no view)
    const sort = activeView ? sortFromView : sortOverride ?? undefined;
    return {
      tableId,
      limit: PAGE_SIZE,
      searchQuery,
      filter,
      sort,
    };
  }, [tableId, table?.columns, activeView, urlSearch, urlStatus, sortOverride, debouncedSearch]);

  const columns = useMemo(() => {
    const allCols = table?.columns ?? [];
    if (activeView?.columnVisibility && activeView.columnVisibility.length > 0) {
      const visibleFromView = activeView.columnVisibility
        .filter((v) => v.visible)
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .map((v) => v.column);
      const idsInView = new Set(
        activeView.columnVisibility.map((v) => v.columnId)
      );
      const notInView = allCols.filter((c) => !idsInView.has(c.id));
      if (visibleFromView.length > 0 || notInView.length > 0) {
        return [...visibleFromView, ...notInView];
      }
    }
    return allCols;
  }, [table?.columns, activeView?.columnVisibility]);

  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showCreateViewModal, setShowCreateViewModal] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [hideFieldsOpen, setHideFieldsOpen] = useState(false);
  const [columnSearchQuery, setColumnSearchQuery] = useState("");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [filterColumnId, setFilterColumnId] = useState("");
  const [filterOperator, setFilterOperator] = useState("");
  const [filterValue, setFilterValue] = useState("");

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [rowContextMenu, setRowContextMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const resizingRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = columnWidths[columnId] ?? 180;
    resizingRef.current = { columnId, startX: e.clientX, startWidth };

    const handleMouseMove = (me: MouseEvent) => {
      const ref = resizingRef.current;
      if (!ref) return;
      const diff = me.clientX - ref.startX;
      const newWidth = Math.max(80, ref.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [ref.columnId]: newWidth }));
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [columnWidths]);

  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const lastSyncedViewId = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeView?.id !== lastSyncedViewId.current) {
      lastSyncedViewId.current = activeView?.id ?? null;
      const q = activeView?.searchQuery ?? "";
      setLocalSearch(q);
      setDebouncedSearch(q);
    }
  }, [activeView?.id, activeView?.searchQuery]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const visibilityByColumnId = useMemo(() => {
    const m = new Map<string, boolean>();
    activeView?.columnVisibility?.forEach((v) => m.set(v.columnId, v.visible));
    return m;
  }, [activeView?.columnVisibility]);

  const getColumnVisible = useCallback(
    (columnId: string) => visibilityByColumnId.get(columnId) ?? true,
    [visibilityByColumnId]
  );

  const updateView = trpc.view.update.useMutation({
    onMutate: async (input) => {
      if (!tableId) return;
      await utils.view.listByTableId.cancel({ tableId });
      const previous = utils.view.listByTableId.getData({ tableId });
      utils.view.listByTableId.setData({ tableId }, (old) => {
        if (!old) return old;
        return old.map((v) => {
          if (v.id !== input.id) return v;
          const updated = { ...v };
          const now = new Date();
          if (input.columnVisibility !== undefined) {
            updated.columnVisibility = input.columnVisibility.map((cv) => ({
              id: `optimistic-${cv.columnId}`,
              viewId: v.id,
              columnId: cv.columnId,
              visible: cv.visible,
              position: cv.position ?? 0,
              createdById: null,
              createdAt: now,
              updatedAt: now,
              column: (v.columnVisibility?.find((x) => x.columnId === cv.columnId)?.column ??
                allTableColumns.find((c) => c.id === cv.columnId)) as typeof v.columnVisibility[number]["column"],
            }));
          }
          if (input.filters !== undefined) {
            updated.filters = input.filters.map((f, i) => ({
              id: `optimistic-filter-${i}`,
              viewId: v.id,
              columnId: f.columnId,
              operator: f.operator,
              value: f.value ?? null,
              position: i,
              createdById: null,
              createdAt: now,
              updatedAt: now,
              column: (v.filters?.find((x) => x.columnId === f.columnId)?.column ??
                allTableColumns.find((c) => c.id === f.columnId)) as typeof v.filters[number]["column"],
            }));
          }
          if (input.sorts !== undefined) {
            updated.sorts = input.sorts.map((s, i) => ({
              id: `optimistic-sort-${i}`,
              viewId: v.id,
              columnId: s.columnId,
              direction: s.direction,
              priority: i,
              createdById: null,
              createdAt: now,
              updatedAt: now,
              column: (v.sorts?.find((x) => x.columnId === s.columnId)?.column ??
                allTableColumns.find((c) => c.id === s.columnId)) as typeof v.sorts[number]["column"],
            }));
          }
          if (input.searchQuery !== undefined) {
            updated.searchQuery = input.searchQuery;
          }
          if (input.name !== undefined) {
            updated.name = input.name;
          }
          return updated;
        });
      });
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (tableId && context?.previous) {
        utils.view.listByTableId.setData({ tableId }, context.previous);
      }
    },
    onSettled: () => {
      if (tableId) {
        void utils.view.listByTableId.invalidate({ tableId });
      }
    },
  });

  // When switching views, clear any temporary sort so we use the new view's sort
  useEffect(() => {
    setSortOverride(null);
  }, [activeView?.id]);

  const filteredViews = useMemo(() => {
    const q = viewSearchQuery.trim().toLowerCase();
    if (!q) return views;
    return views.filter((v) => v.name.toLowerCase().includes(q));
  }, [views, viewSearchQuery]);

  const userInitial = session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? "?";

  const allTableColumns = table?.columns ?? [];
  const filteredColumnsForHideFields = useMemo(() => {
    const q = columnSearchQuery.trim().toLowerCase();
    if (!q) return allTableColumns;
    return allTableColumns.filter((c) =>
      c.name.toLowerCase().includes(q)
    );
  }, [allTableColumns, columnSearchQuery]);

  const handleToggleColumnVisibility = useCallback(
    (columnId: string) => {
      if (!activeView?.id) return;
      const nextVisibility = allTableColumns.map((col, position) => ({
        columnId: col.id,
        visible: col.id === columnId ? !getColumnVisible(col.id) : getColumnVisible(col.id),
        position,
      }));
      updateView.mutate({ id: activeView.id, columnVisibility: nextVisibility });
    },
    [activeView?.id, allTableColumns, getColumnVisible, updateView]
  );

  const utils = trpc.useUtils();

  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const countInput = useMemo(() => {
    if (!tableId) return undefined;
    return {
      tableId,
      searchQuery: listInput?.searchQuery,
      filter: listInput?.filter,
    };
  }, [tableId, listInput?.searchQuery, listInput?.filter]);

  const { data: rowCountData } = trpc.row.count.useQuery(
    countInput!,
    { enabled: !!countInput, refetchInterval: batchProgress ? 3000 : false },
  );

  const totalRowCount = rowCountData?.count ?? 0;

  // Page cache for offset-based random-access scrolling
  type RowType = { id: string; index: number; tableId: string; cells: { id: string; columnId: string; textValue: string | null; numberValue: number | null; rowId: string }[] };
  const pageCache = useRef<Map<number, RowType[]>>(new Map());
  const loadingPages = useRef<Set<number>>(new Set());
  const pageFetchGen = useRef<Map<number, number>>(new Map());
  const cacheGeneration = useRef(0);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const listInputKey = JSON.stringify(listInput);
  useEffect(() => {
    pageCache.current.clear();
    loadingPages.current.clear();
    pageFetchGen.current.clear();
    cacheGeneration.current += 1;
    setInitialLoading(true);
    setLoadError(false);
    setCacheVersion((v) => v + 1);
  }, [listInputKey]);

  const fetchPage = useCallback(
    async (pageNum: number) => {
      if (!listInput || loadingPages.current.has(pageNum)) return;
      const currentGen = cacheGeneration.current;
      const pageGen = pageFetchGen.current.get(pageNum);
      if (pageGen === currentGen) return;
      loadingPages.current.add(pageNum);
      try {
        const data = await utils.row.listPage.fetch({
          tableId: listInput.tableId,
          offset: pageNum * PAGE_SIZE,
          limit: PAGE_SIZE,
          searchQuery: listInput.searchQuery,
          sort: listInput.sort,
          filter: listInput.filter,
        });
        pageCache.current.set(pageNum, data.rows as RowType[]);
        pageFetchGen.current.set(pageNum, currentGen);
        setInitialLoading(false);
        setCacheVersion((v) => v + 1);
      } catch {
        setLoadError(true);
        setInitialLoading(false);
      } finally {
        loadingPages.current.delete(pageNum);
      }
    },
    [listInput, utils],
  );

  // Eagerly fetch page 0 so content appears before count query resolves
  useEffect(() => {
    if (listInput) void fetchPage(0);
  }, [listInput, fetchPage]);

  const invalidateRows = useCallback(() => {
    if (tableId) {
      cacheGeneration.current += 1;
      loadingPages.current.clear();
      setCacheVersion((v) => v + 1);
      void utils.row.count.invalidate({ tableId });
    }
  }, [tableId, utils]);

  const createRow = trpc.row.create.useMutation({
    onMutate: () => {
      if (!countInput) return;
      const prev = utils.row.count.getData(countInput);
      utils.row.count.setData(countInput, (old) =>
        old ? { count: old.count + 1 } : old
      );
      return { prev };
    },
    onError: (_err, _input, context) => {
      if (countInput && context?.prev) {
        utils.row.count.setData(countInput, context.prev);
      }
    },
    onSettled: invalidateRows,
  });

  const addBatch = trpc.row.addBatch.useMutation();

  const CHUNK_SIZE = 10_000;
  const TOTAL_ROWS = 100_000;

  const runAdd100k = useCallback(async () => {
    if (!tableId || batchProgress) return;
    setBatchProgress(`0 / ${TOTAL_ROWS.toLocaleString()}`);

    const chunks = Math.ceil(TOTAL_ROWS / CHUNK_SIZE);
    let inserted = 0;
    try {
      for (let i = 0; i < chunks; i++) {
        const count = Math.min(CHUNK_SIZE, TOTAL_ROWS - inserted);
        await addBatch.mutateAsync({ tableId, count });
        inserted += count;
        setBatchProgress(`${inserted.toLocaleString()} / ${TOTAL_ROWS.toLocaleString()}`);
        invalidateRows();
      }
      setBatchProgress(null);
    } catch {
      invalidateRows();
      setBatchProgress(null);
    }
  }, [tableId, batchProgress, addBatch, invalidateRows, utils]);

  const isThisTableAdding100k = batchProgress !== null;

  const updateCell = trpc.row.updateCell.useMutation();
  const deleteRow = trpc.row.delete.useMutation({
    onMutate: (input) => {
      for (const [pageNum, pageRows] of pageCache.current.entries()) {
        const filtered = pageRows.filter((r) => r.id !== input.id);
        if (filtered.length !== pageRows.length) {
          pageCache.current.set(pageNum, filtered);
          setCacheVersion((v) => v + 1);
          break;
        }
      }
    },
    onSettled: invalidateRows,
  });

  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const previousCellValueRef = useRef<string>("");

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

  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setLocalSearch(raw);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(raw);
        if (activeView?.id) {
          updateView.mutate({ id: activeView.id, searchQuery: raw.trim() || null });
        } else {
          setUrlFilters({ search: raw || undefined });
        }
      }, 200);
    },
    [activeView?.id, updateView, setUrlFilters]
  );

  const handleCloseSearch = useCallback(() => {
    setSearchModalOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleClearSearch = useCallback(() => {
    setLocalSearch("");
    setDebouncedSearch("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (activeView?.id) {
      updateView.mutate({ id: activeView.id, searchQuery: null });
    } else {
      setUrlFilters({ search: undefined });
    }
    setSearchModalOpen(false);
  }, [activeView?.id, updateView, setUrlFilters]);

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
      const textVal = isNumber ? null : (value.trim() || null);
      const numVal =
        isNumber ? (value.trim() === "" ? null : Number(value)) : null;
      for (const [pageNum, pageRows] of pageCache.current.entries()) {
        const updated = pageRows.map((row) => {
          if (row.id !== rowId) return row;
          const cells = row.cells.map((c) =>
            c.columnId === columnId
              ? { ...c, textValue: textVal, numberValue: numVal }
              : c
          );
          return { ...row, cells };
        });
        pageCache.current.set(pageNum, updated);
      }
      setCacheVersion((v) => v + 1);
    },
    []
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


  const handleCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      rowId: string,
      columnId: string,
      columnType: string,
      rowIndex: number,
      colIndex: number
    ) => {
      if (e.key === "Enter") {
        saveCell(rowId, columnId, columnType);
        return;
      }
      if (e.key === "Escape") {
        cancelEditing();
        return;
      }
      const numRows = totalRowCount;
      const numCols = columns.length;
      if (numRows === 0 || numCols === 0) return;

      let nextRow = rowIndex;
      let nextCol = colIndex;
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          nextCol = colIndex - 1;
          if (nextCol < 0) {
            nextCol = numCols - 1;
            nextRow = rowIndex - 1;
          }
          if (nextRow < 0) nextRow = numRows - 1;
        } else {
          nextCol = colIndex + 1;
          if (nextCol >= numCols) {
            nextCol = 0;
            nextRow = rowIndex + 1;
          }
          if (nextRow >= numRows) nextRow = 0;
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextCol = Math.min(colIndex + 1, numCols - 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nextCol = Math.max(0, colIndex - 1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nextRow = Math.min(rowIndex + 1, numRows - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nextRow = Math.max(0, rowIndex - 1);
      } else {
        return;
      }

      saveCell(rowId, columnId, columnType);
      const pageNum = Math.floor(nextRow / PAGE_SIZE);
      const targetRow = pageCache.current.get(pageNum)?.[nextRow - pageNum * PAGE_SIZE];
      const targetCol = columns[nextCol];
      if (targetRow && targetCol) {
        startEditing(
          targetRow.id,
          targetCol.id,
          getCellValue(targetRow, targetCol.id)
        );
      }
    },
    [totalRowCount, columns, saveCell, cancelEditing, startEditing]
  );

  const rowVirtualizer = useVirtualizer({
    count: totalRowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Fetch visible pages on demand
  useEffect(() => {
    if (!virtualRows.length || !listInput) return;
    const firstPage = Math.floor(virtualRows[0]!.index / PAGE_SIZE);
    const lastPage = Math.floor(virtualRows[virtualRows.length - 1]!.index / PAGE_SIZE);
    for (let p = Math.max(0, firstPage - 1); p <= lastPage + 1; p++) {
      void fetchPage(p);
    }
  }, [virtualRows, fetchPage, listInput, cacheVersion]);

  const firstColWidth = columns[0] ? (columnWidths[columns[0].id] ?? 208) : 208;

  const dataColWidths = useMemo(
    () => columns.map((col, i) => `${columnWidths[col.id] ?? (i === 0 ? 208 : 180)}px`).join(" "),
    [columns, columnWidths]
  );

  const gridCols = `56px ${dataColWidths} 94px`;
  const rowGridCols = `56px ${dataColWidths}`;

  const gridScrollStyle = { "--first-col-right": `${56 + firstColWidth}px` } as React.CSSProperties;

  // TanStack Table: only process the visible virtual window, not all 100k rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columnDefs = useMemo((): ColumnDef<any>[] => {
    return columns.map((col) => ({
      id: col.id,
      accessorFn: (row: Record<string, unknown>) => getCellValue(row as Parameters<typeof getCellValue>[0], col.id),
      header: col.name,
      meta: { type: col.type, name: col.name },
    }));
  }, [columns]);

  const visibleData = useMemo(() => {
    return virtualRows.map((vr) => {
      const pageNum = Math.floor(vr.index / PAGE_SIZE);
      const pageRows = pageCache.current.get(pageNum);
      const r = pageRows?.[vr.index - pageNum * PAGE_SIZE];
      if (r) return { ...r, _globalIndex: vr.index, _loaded: true as const };
      return {
        id: `loading-${vr.index}`,
        cells: [] as RowType["cells"],
        _globalIndex: vr.index,
        _loaded: false as const,
      };
    });
  }, [virtualRows, cacheVersion]);

  const tableInstance = useReactTable({
    data: visibleData,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!baseId || !tableId) return null;

  if (tableStatus === "pending" || (tableStatus === "success" && !table)) {
    return (
      <>
        <Head><title>Table – Airtable</title></Head>
        <AppLayout bare>
          <div className={s.skeletonPage}>
            <div className={s.skeletonToolbar}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={s.skeletonToolbarItem} style={{ width: 48 + i * 12 }} />
              ))}
            </div>
            <div className={s.gridScroll}>
              <div className={s.gridHeader} style={{ display: "grid", gridTemplateColumns: `56px 208px repeat(3, 180px) 94px` }}>
                <div className={s.cellHeader} />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={s.cellHeader}>
                    <div className={s.skeletonHeaderBar} style={{ width: `${50 + i * 10}%` }} />
                  </div>
                ))}
                <div className={s.cellHeader} />
              </div>
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className={s.skeletonRow} style={{ display: "grid", gridTemplateColumns: `56px 208px repeat(3, 180px) 94px` }}>
                  <div className={s.skeletonCell}>
                    <div className={s.skeletonBar} style={{ width: 20 }} />
                  </div>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className={s.skeletonCell}>
                      <div className={s.skeletonBar} style={{ width: `${30 + ((i + j) * 17) % 50}%` }} />
                    </div>
                  ))}
                  <div className={s.skeletonCell} />
                </div>
              ))}
            </div>
          </div>
        </AppLayout>
      </>
    );
  }

  if (tableStatus === "error") {
    return (
      <>
        <Head><title>Table – Airtable</title></Head>
        <AppLayout bare>
          <div className={s.errorBlock}>
            <p className={s.mutedText}>Table not found.</p>
            <Link href={`/bases/${baseId}`} className={s.primaryButton} style={{ textDecoration: "none" }}>
              Back to base
            </Link>
          </div>
        </AppLayout>
      </>
    );
  }

  const baseColor = getBaseColor(table.base.name);

  return (
    <>
      <Head>
        <title>{table.name} – {table.base.name} – Airtable</title>
      </Head>
      <AppLayout bare>
        <div className={s.pageRow}>
          {/* ─── Left icon bar (full-height) ─── */}
          <div className={s.leftIconBar}>
            <div className={s.leftIconBarTop}>
              <Link href="/" className={s.leftIconBtn} aria-label="Airtable home">
                <svg width="24" height="21" viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg" style={{ shapeRendering: "geometricPrecision" }}>
                  <g>
                    <path fill="#1a1a1a" d="M90.0389,12.3675 L24.0799,39.6605 C20.4119,41.1785 20.4499,46.3885 24.1409,47.8515 L90.3759,74.1175 C96.1959,76.4255 102.6769,76.4255 108.4959,74.1175 L174.7319,47.8515 C178.4219,46.3885 178.4609,41.1785 174.7919,39.6605 L108.8339,12.3675 C102.8159,9.8775 96.0559,9.8775 90.0389,12.3675" />
                    <path fill="#1a1a1a" d="M105.3122,88.4608 L105.3122,154.0768 C105.3122,157.1978 108.4592,159.3348 111.3602,158.1848 L185.1662,129.5368 C186.8512,128.8688 187.9562,127.2408 187.9562,125.4288 L187.9562,59.8128 C187.9562,56.6918 184.8092,54.5548 181.9082,55.7048 L108.1022,84.3528 C106.4182,85.0208 105.3122,86.6488 105.3122,88.4608" />
                    <path fill="#1a1a1a" d="M88.0781,91.8464 L66.1741,102.4224 L63.9501,103.4974 L17.7121,125.6524 C14.7811,127.0664 11.0401,124.9304 11.0401,121.6744 L11.0401,60.0884 C11.0401,58.9104 11.6441,57.8934 12.4541,57.1274 C12.7921,56.7884 13.1751,56.5094 13.5731,56.2884 C14.6781,55.6254 16.2541,55.4484 17.5941,55.9784 L87.7101,83.7594 C91.2741,85.1734 91.5541,90.1674 88.0781,91.8464" />
                  </g>
                </svg>
              </Link>
            </div>
            <div className={s.leftIconBarBottom}>
              <button type="button" className={s.leftIconBtn} aria-label="Help">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.25" /><path d="M6 6.5a2 2 0 0 1 3.87.5c0 1-1.37 1.5-1.37 1.5M8 11h.01" /></svg>
              </button>
              <button type="button" className={s.leftIconBtn} aria-label="Notifications">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6a4 4 0 0 1 8 0c0 4.5 2 5.5 2 5.5H2S4 10.5 4 6zM6.5 12.5a1.5 1.5 0 0 0 3 0" />
                </svg>
              </button>
              <span
                ref={avatarRef}
                className={s.leftIconAvatar}
                title={session?.user?.email ?? undefined}
                onClick={() => setProfileOpen((v) => !v)}
                role="button"
                tabIndex={0}
              >
                {userInitial.toUpperCase()}
              </span>
              {profileOpen && (
                <ProfileDropdown
                  anchorRef={avatarRef}
                  onClose={() => setProfileOpen(false)}
                  position="side-right"
                />
              )}
            </div>
          </div>

          <div className={s.gridLayout}>
          {/* ─── Base header bar ─── */}
          <div className={s.headerBar}>
            <div className={s.baseIcon} style={{ background: baseColor }}>
              <div className={s.baseIconInner}>
                <svg width="24" height="20" viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg" style={{ shapeRendering: "geometricPrecision" }}>
                  <g>
                    <path fill="hsla(0,0%,100%,0.95)" d="M90.0389,12.3675 L24.0799,39.6605 C20.4119,41.1785 20.4499,46.3885 24.1409,47.8515 L90.3759,74.1175 C96.1959,76.4255 102.6769,76.4255 108.4959,74.1175 L174.7319,47.8515 C178.4219,46.3885 178.4609,41.1785 174.7919,39.6605 L108.8339,12.3675 C102.8159,9.8775 96.0559,9.8775 90.0389,12.3675" />
                    <path fill="hsla(0,0%,100%,0.95)" d="M105.3122,88.4608 L105.3122,154.0768 C105.3122,157.1978 108.4592,159.3348 111.3602,158.1848 L185.1662,129.5368 C186.8512,128.8688 187.9562,127.2408 187.9562,125.4288 L187.9562,59.8128 C187.9562,56.6918 184.8092,54.5548 181.9082,55.7048 L108.1022,84.3528 C106.4182,85.0208 105.3122,86.6488 105.3122,88.4608" />
                    <path fill="hsla(0,0%,100%,0.95)" d="M88.0781,91.8464 L66.1741,102.4224 L63.9501,103.4974 L17.7121,125.6524 C14.7811,127.0664 11.0401,124.9304 11.0401,121.6744 L11.0401,60.0884 C11.0401,58.9104 11.6441,57.8934 12.4541,57.1274 C12.7921,56.7884 13.1751,56.5094 13.5731,56.2884 C14.6781,55.6254 16.2541,55.4484 17.5941,55.9784 L87.7101,83.7594 C91.2741,85.1734 91.5541,90.1674 88.0781,91.8464" />
                  </g>
                </svg>
              </div>
            </div>
            <Link href={`/bases/${baseId}`} className={s.baseLink}>
              {table.base.name}
            </Link>
            <button type="button" className={s.chevronBtn} aria-label="Base menu">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" /></svg>
            </button>

            <div className={s.headerRight} />
          </div>

          {/* ─── Table tabs row ─── */}
          <div className={s.tableTabsRow} style={{ background: `color-mix(in srgb, ${baseColor} 8%, #fff)` }}>
            {allTables.map((t) => (
              <Link
                key={t.id}
                href={`/bases/${baseId}/tables/${t.id}`}
                className={t.id === tableId ? s.tableTabActive : s.tableTab}
              >
                {t.name}
              </Link>
            ))}
            <button
              type="button"
              className={s.addTableBtn}
              onClick={() => setShowCreateTableModal(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
              Add or import
            </button>
          </div>

          {baseId && showCreateTableModal && (
            <CreateTableModal
              baseId={baseId}
              onClose={() => setShowCreateTableModal(false)}
            />
          )}

          {showCreateViewModal && tableId && table && (
            <CreateViewModal
              tableId={tableId}
              columns={table.columns}
              viewCount={views.length}
              onClose={() => setShowCreateViewModal(false)}
              onSuccess={(newViewId) => {
                void router.push(
                  {
                    pathname: router.pathname,
                    query: { ...router.query, view: newViewId },
                  },
                  undefined,
                  { shallow: true }
                );
              }}
            />
          )}

          {/* ─── Toolbar (single full-width bar) ─── */}
          <div className={s.toolbar}>
            <button
              type="button"
              className={s.sidebarToggleBtn}
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? "Close view sidebar" : "Open view sidebar"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
            </button>
            <span className={s.viewSidebarTitle}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="rgb(22,110,225)" style={{shapeRendering: "geometricPrecision"}} aria-hidden="true">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM3.5 3a.5.5 0 0 0-.5.5V6h4V3H3.5ZM8 3v3h5V3.5a.5.5 0 0 0-.5-.5H8ZM3 7v2h4V7H3Zm5 0v2h5V7H8ZM3 10v2.5a.5.5 0 0 0 .5.5H7v-3H3Zm5 0v3h4.5a.5.5 0 0 0 .5-.5V10H8Z" />
              </svg>
              {activeView?.name ?? "Grid view"}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className={s.viewSidebarChevron}>
                <path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </span>
            <div className={s.toolbarRight}>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={s.toolbarBtn}
                    onClick={() => setHideFieldsOpen((o) => !o)}
                    aria-expanded={hideFieldsOpen}
                    aria-haspopup="dialog"
                    aria-label="Hide fields"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2.5l11 11" /><path d="M4.2 6.3C3.2 7 2.5 8 2.5 8s2.5 4 5.5 4c.8 0 1.6-.3 2.2-.6" /><path d="M11 10.4c1.3-.9 2-2.1 2.2-2.4-0-.1-2.5-4-5.2-4-.5 0-1 .1-1.5.3" /><circle cx="8" cy="8" r="2" /></svg>
                    Hide fields
                  </button>
                  {hideFieldsOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setHideFieldsOpen(false)}
                      />
                      <div className={s.hideFieldsDropdown} role="dialog" aria-label="Column visibility">
                        <input
                          type="search"
                          className={s.hideFieldsSearch}
                          placeholder="Search columns"
                          value={columnSearchQuery}
                          onChange={(e) => setColumnSearchQuery(e.target.value)}
                          autoFocus
                          aria-label="Search columns"
                        />
                        <div className={s.hideFieldsList}>
                          {!activeView ? (
                            <div className={s.hideFieldsEmpty}>
                              Select a view to change column visibility
                            </div>
                          ) : filteredColumnsForHideFields.length === 0 ? (
                            <div className={s.hideFieldsEmpty}>
                              {columnSearchQuery.trim() ? "No columns match" : "No columns"}
                            </div>
                          ) : (
                            filteredColumnsForHideFields.map((col) => (
                              <label key={col.id} className={s.hideFieldsRow}>
                                <input
                                  type="checkbox"
                                  checked={getColumnVisible(col.id)}
                                  onChange={() => handleToggleColumnVisibility(col.id)}
                                  disabled={updateView.isPending}
                                />
                                <span className={s.hideFieldsLabel}>{col.name}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={s.toolbarBtn}
                    onClick={() => {
                      const first = activeView?.filters?.[0];
                      const firstCol = table?.columns?.[0];
                      setFilterColumnId(first?.columnId ?? firstCol?.id ?? "");
                      setFilterOperator(first?.operator ?? "IS_NOT_EMPTY");
                      setFilterValue(first?.value ?? "");
                      setFilterDropdownOpen((o) => !o);
                    }}
                    aria-expanded={filterDropdownOpen}
                    aria-haspopup="dialog"
                    aria-label="Filter"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M5 8h6M7 12h2" /></svg>
                    Filter
                  </button>
                  {filterDropdownOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setFilterDropdownOpen(false)}
                      />
                      <div className={s.filterDropdown} role="dialog" aria-label="Filter">
                        {!activeView ? (
                          <div className={s.filterDropdownEmpty}>
                            Select a view to add a filter
                          </div>
                        ) : (
                          <>
                            <div className={s.filterDropdownRow}>
                              <label className={s.filterDropdownLabel}>Column</label>
                              <select
                                className={s.filterDropdownSelect}
                                value={filterColumnId}
                                onChange={(e) => {
                                  setFilterColumnId(e.target.value);
                                  setFilterOperator("IS_NOT_EMPTY");
                                  setFilterValue("");
                                }}
                              >
                                {(table?.columns ?? []).map((col) => (
                                  <option key={col.id} value={col.id}>
                                    {col.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className={s.filterDropdownRow}>
                              <label className={s.filterDropdownLabel}>Condition</label>
                              <select
                                className={s.filterDropdownSelect}
                                value={filterOperator}
                                onChange={(e) => setFilterOperator(e.target.value)}
                              >
                                {((table?.columns ?? []).find((c) => c.id === filterColumnId)?.type === "NUMBER"
                                  ? NUMBER_FILTER_OPERATORS
                                  : TEXT_FILTER_OPERATORS
                                ).map((op) => (
                                  <option key={op.value} value={op.value}>
                                    {op.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {(NUMBER_FILTER_OPERATORS.find((o) => o.value === filterOperator)?.needsValue ??
                              TEXT_FILTER_OPERATORS.find((o) => o.value === filterOperator)?.needsValue) && (
                              <div className={s.filterDropdownRow}>
                                <label className={s.filterDropdownLabel}>Value</label>
                                <input
                                  type={(table?.columns ?? []).find((c) => c.id === filterColumnId)?.type === "NUMBER" ? "number" : "text"}
                                  className={s.filterDropdownInput}
                                  value={filterValue}
                                  onChange={(e) => setFilterValue(e.target.value)}
                                  placeholder={(table?.columns ?? []).find((c) => c.id === filterColumnId)?.type === "NUMBER" ? "Number" : "Text"}
                                />
                              </div>
                            )}
                            <div className={s.filterDropdownActions}>
                              <button
                                type="button"
                                className={s.filterDropdownApply}
                                onClick={() => {
                                  if (!activeView?.id || !filterColumnId || !filterOperator) return;
                                  const needsVal = (NUMBER_FILTER_OPERATORS.find((o) => o.value === filterOperator) ?? TEXT_FILTER_OPERATORS.find((o) => o.value === filterOperator))?.needsValue;
                                  updateView.mutate({
                                    id: activeView.id,
                                    filters: [
                                      {
                                        columnId: filterColumnId,
                                        operator: filterOperator as "IS_EMPTY" | "IS_NOT_EMPTY" | "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "GREATER_THAN" | "LESS_THAN",
                                        value: needsVal ? filterValue.trim() || null : null,
                                      },
                                    ],
                                  });
                                  setFilterDropdownOpen(false);
                                }}
                                disabled={updateView.isPending}
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                className={s.filterDropdownClear}
                                onClick={() => {
                                  if (!activeView?.id) return;
                                  updateView.mutate({ id: activeView.id, filters: [] });
                                  setFilterDropdownOpen(false);
                                }}
                                disabled={updateView.isPending}
                              >
                                Clear filter
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={s.toolbarBtn}
                    onClick={() => setSortDropdownOpen((o) => !o)}
                    aria-expanded={sortDropdownOpen}
                    aria-haspopup="menu"
                    aria-label="Sort"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6l4-4 4 4M4 10l4 4 4-4" /></svg>
                    Sort
                  </button>
                  {sortDropdownOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setSortDropdownOpen(false)}
                      />
                      <div className={s.sortDropdown} role="menu" aria-label="Sort by">
                        <div className={s.sortDropdownTitle}>Sort by</div>
                        {columns.map((col) => (
                          <div key={col.id} className={s.sortDropdownColumn}>
                            <span className={s.sortDropdownColumnName}>{col.name}</span>
                            <button
                              type="button"
                              role="menuitem"
                              className={s.sortDropdownOption}
                              onClick={() => {
                                if (activeView?.id) {
                                  updateView.mutate({
                                    id: activeView.id,
                                    sorts: [{ columnId: col.id, direction: "ASC" }],
                                  });
                                } else {
                                  setSortOverride({ columnId: col.id, direction: "asc" });
                                }
                                setSortDropdownOpen(false);
                              }}
                            >
                              {col.type === "NUMBER" ? "Low to high" : "A→Z"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className={s.sortDropdownOption}
                              onClick={() => {
                                if (activeView?.id) {
                                  updateView.mutate({
                                    id: activeView.id,
                                    sorts: [{ columnId: col.id, direction: "DESC" }],
                                  });
                                } else {
                                  setSortOverride({ columnId: col.id, direction: "desc" });
                                }
                                setSortDropdownOpen(false);
                              }}
                            >
                              {col.type === "NUMBER" ? "High to low" : "Z→A"}
                            </button>
                          </div>
                        ))}
                        {listInput?.sort?.columnId && (
                          <button
                            type="button"
                            role="menuitem"
                            className={s.sortDropdownClear}
                            onClick={() => {
                              if (activeView?.id) {
                                updateView.mutate({ id: activeView.id, sorts: [] });
                              } else {
                                setSortOverride(null);
                              }
                              setSortDropdownOpen(false);
                            }}
                          >
                            Clear sort
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
            <button
              type="button"
              className={s.toolbarIconBtn}
              onClick={() => setSearchModalOpen(true)}
              aria-label="Search records"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
            </button>
            </div>
          </div>
          {searchModalOpen && (
            <div className={s.searchBackdrop} onMouseDown={handleCloseSearch}>
              <div
                className={s.searchModal}
                role="dialog"
                aria-label="Search records"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={s.searchModalHeader}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={s.searchModalIcon}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
                  <input
                    ref={(el) => { if (el && document.activeElement !== el) el.focus(); }}
                    type="text"
                    className={s.searchModalInput}
                    placeholder="Search records…"
                    value={localSearch}
                    onChange={handleSearchChange}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") handleCloseSearch();
                    }}
                    aria-label="Search records"
                  />
                  {localSearch && (
                    <button
                      type="button"
                      className={s.searchModalClose}
                      onClick={handleClearSearch}
                      aria-label="Clear search"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className={s.searchModalClose}
                    onClick={handleCloseSearch}
                    aria-label="Close search"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Grid content area (horizontal layout) ─── */}
          <div className={s.gridContent}>
            {/* ─── View sidebar body (collapsible) ─── */}
            <div className={`${s.viewSidebar} ${!sidebarOpen ? s.viewSidebarCollapsed : ""}`}>
              <button
                type="button"
                className={s.viewSidebarCreateBtn}
                onClick={() => setShowCreateViewModal(true)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                Create new...
              </button>
              <div className={s.viewSidebarSearch}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={s.viewSidebarSearchIcon}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" strokeLinecap="round" /></svg>
                <input
                  type="search"
                  className={s.viewSidebarSearchInput}
                  placeholder="Find a view"
                  value={viewSearchQuery}
                  onChange={(e) => setViewSearchQuery(e.target.value)}
                  aria-label="Find a view"
                />
              </div>
              <div className={s.viewList}>
                {filteredViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={activeView?.id === v.id ? s.viewItemActive : s.viewItem}
                    onClick={() => {
                      void router.push(
                        { pathname: router.pathname, query: { ...router.query, view: v.id } },
                        undefined,
                        { shallow: true }
                      );
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="rgb(22,110,225)" style={{shapeRendering: "geometricPrecision"}} className={s.viewItemIcon} aria-hidden="true">
                      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM3.5 3a.5.5 0 0 0-.5.5V6h4V3H3.5ZM8 3v3h5V3.5a.5.5 0 0 0-.5-.5H8ZM3 7v2h4V7H3Zm5 0v2h5V7H8ZM3 10v2.5a.5.5 0 0 0 .5.5H7v-3H3Zm5 0v3h4.5a.5.5 0 0 0 .5-.5V10H8Z" />
                    </svg>
                    {v.name}
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Grid panel (grid + summary) ─── */}
            <div className={s.gridPanel} style={gridScrollStyle}>
              {/* ─── Grid ─── */}
              {initialLoading ? (
                <div className={s.gridScroll} style={gridScrollStyle}>
                  <div className={s.gridHeader} style={{ display: "grid", gridTemplateColumns: gridCols }}>
                    <div className={s.cellHeader} />
                    {columns.map((col) => (
                      <div key={col.id} className={s.cellHeader}>
                        <div className={s.skeletonHeaderBar} style={{ width: "60%" }} />
                      </div>
                    ))}
                    <div className={s.cellHeader} />
                  </div>
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className={s.skeletonRow} style={{ display: "grid", gridTemplateColumns: gridCols }}>
                      <div className={s.skeletonCell}>
                        <div className={s.skeletonBar} style={{ width: 20 }} />
                      </div>
                      {columns.map((col, j) => (
                        <div key={col.id} className={s.skeletonCell}>
                          <div className={s.skeletonBar} style={{ width: `${30 + ((i + j) * 17) % 50}%` }} />
                        </div>
                      ))}
                      <div className={s.skeletonCell} />
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <div className={s.errorBlock}>
                  <p className={s.mutedText}>Failed to load rows.</p>
                  <button type="button" className={s.primaryButton} onClick={() => { setLoadError(false); setInitialLoading(true); invalidateRows(); }}>
                    Retry
                  </button>
                </div>
              ) : (
                <div ref={parentRef} className={s.gridScroll} style={gridScrollStyle} role="grid" aria-label={table.name}>
                  {/* Header — TanStack Table header groups */}
                  {tableInstance.getHeaderGroups().map((headerGroup) => (
                    <div
                      key={headerGroup.id}
                      className={s.gridHeader}
                      style={{ display: "grid", gridTemplateColumns: gridCols }}
                    >
                      <div className={s.cellHeaderIndex} />
                      {headerGroup.headers.map((header) => {
                        const col = columns.find((c) => c.id === header.id);
                        if (!col) return null;
                        const columnId = col.id;
                        const isSorted = listInput?.sort?.columnId === columnId;
                        const sortDirection = listInput?.sort?.direction;
                        const handleSortClick = () => {
                          const next =
                            !isSorted
                              ? { columnId, direction: "asc" as const }
                              : sortDirection === "asc"
                                ? { columnId, direction: "desc" as const }
                                : null;
                          if (activeView?.id) {
                            updateView.mutate({
                              id: activeView.id,
                              sorts: next
                                ? [{ columnId: next.columnId, direction: next.direction.toUpperCase() as "ASC" | "DESC" }]
                                : [],
                            });
                          } else {
                            setSortOverride(next);
                          }
                        };
                        return (
                          <div key={header.id} className={s.cellHeader} style={{ position: "relative" }}>
                            <span className={s.fieldTypeIcon}>
                              {col.type === "NUMBER" ? (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2v12M8.5 6v8M11.5 2h-2l-1 4h3M6.5 6H3" /></svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 4h10M3 8h7M3 12h5" /></svg>
                              )}
                            </span>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <div
                              className={s.resizeHandle}
                              onMouseDown={(e) => handleResizeStart(e, columnId)}
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className={s.addColumnCell}
                        onClick={() => setShowAddColumnModal(true)}
                        aria-label="Add column"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                      </button>
                    </div>
                  ))}

                  {showAddColumnModal && tableId && (
                    <AddColumnModal
                      tableId={tableId}
                      position={columns.length}
                      onClose={() => setShowAddColumnModal(false)}
                    />
                  )}

                  {/* Virtual rows rendered via TanStack Table row model */}
                  <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                    {tableInstance.getRowModel().rows.map((tableRow, i) => {
                      const virtualRow = virtualRows[i];
                      if (!virtualRow) return null;
                      const row = tableRow.original as (typeof visibleData)[number];
                      const globalIndex = row._globalIndex;
                      const isLoaded = row._loaded;
                      return (
                        <div
                          key={row.id}
                          className={s.gridRow}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                            display: "grid",
                            gridTemplateColumns: rowGridCols,
                          }}
                          onContextMenu={(e) => {
                            if (!isLoaded) return;
                            e.preventDefault();
                            setRowContextMenu({ rowId: row.id, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <div className={s.cellIndex} style={isLoaded ? undefined : { opacity: 0.4 }}>
                            <span>{globalIndex + 1}</span>
                          </div>
                          {isLoaded ? (
                            tableRow.getVisibleCells().map((cell, colIndex) => {
                              const col = columns[colIndex];
                              if (!col) return null;
                              const columnId = col.id;
                              const columnType = col.type;
                              const isEditing =
                                editingCell?.rowId === row.id && editingCell?.columnId === columnId;
                              const displayValue = cell.getValue() as string;
                              return (
                                <div
                                  key={cell.id}
                                  className={s.cell}
                                  onClick={() =>
                                    !isEditing && startEditing(row.id, columnId, displayValue)
                                  }
                                >
                                  {isEditing ? (
                                    <input
                                      type={columnType === "NUMBER" ? "number" : "text"}
                                      className={s.cellInput}
                                      value={draftValue}
                                      onChange={(e) => setDraftValue(e.target.value)}
                                      onBlur={() => saveCell(row.id, columnId, columnType)}
                                      onKeyDown={(e) =>
                                        handleCellKeyDown(
                                          e,
                                          row.id,
                                          columnId,
                                          columnType,
                                          globalIndex,
                                          colIndex
                                        )
                                      }
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    flexRender(cell.column.columnDef.cell, cell.getContext())
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            columns.map((col, ci) => (
                              <div key={col.id} className={s.cell}>
                                <div className={s.skeletonBar} style={{ width: `${30 + ((globalIndex + ci) * 17) % 40}%`, height: 10 }} />
                              </div>
                            ))
                          )}
                          <div className={s.addColumnCell} />
                        </div>
                      );
                    })}
                  </div>

                  {/* Add row bar */}
                  <button
                    type="button"
                    className={s.addRowBar}
                    style={{ width: rowGridCols.split(" ").reduce((sum, w) => sum + parseInt(w), 0) }}
                    disabled={createRow.isPending || isThisTableAdding100k}
                    onClick={() => createRow.mutate({ tableId: tableId! })}
                    aria-label="Add row"
                  >
                    <span className={s.addRowIcon}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                    </span>
                  </button>
                </div>
              )}

              {/* Row context menu */}
              {rowContextMenu && (
                <>
                  <div
                    className={s.contextMenuBackdrop}
                    onMouseDown={() => setRowContextMenu(null)}
                  />
                  <div
                    className={s.contextMenu}
                    style={{ top: rowContextMenu.y, left: rowContextMenu.x }}
                  >
                    <button
                      type="button"
                      className={s.contextMenuItem}
                      disabled={deleteRow.isPending}
                      onClick={() => {
                        deleteRow.mutate({ id: rowContextMenu.rowId });
                        setRowContextMenu(null);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M6 7v4M10 7v4M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" /></svg>
                      Delete row
                    </button>
                  </div>
                </>
              )}

              {/* Summary bar */}
              <div className={s.summaryBar}>
                {totalRowCount.toLocaleString()} record{totalRowCount !== 1 ? "s" : ""}
              </div>
              <button
                type="button"
                className={s.floatingActionBtn}
                disabled={isThisTableAdding100k || createRow.isPending}
                onClick={() => void runAdd100k()}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                {batchProgress ? `Adding… ${batchProgress}` : "Add 100k rows"}
              </button>
            </div>
          </div>
        </div>
        </div>
      </AppLayout>
    </>
  );
}
