import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useRef, useMemo, useState, useCallback, useEffect, type ChangeEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { useSession } from "next-auth/react";

import toast from "react-hot-toast";
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

type GridRowProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableRow: { id: string; getVisibleCells: () => any[] };
  row: { id: string; cells: Array<{ columnId: string; textValue: string | null; numberValue: number | null }> };
  columns: { id: string; name: string; type: string }[];
  rowGridCols: string;
  globalIndex: number;
  isLoaded: boolean;
  editingState: { columnId: string; draftValue: string } | null;
  onStartEditing: (rowId: string, columnId: string, displayValue: string) => void;
  onSaveCell: (rowId: string, columnId: string, columnType: string) => void;
  onCellKeyDown: (e: React.KeyboardEvent, rowId: string, columnId: string, columnType: string, rowIndex: number, colIndex: number) => void;
  onContextMenu: (rowId: string, e: React.MouseEvent) => void;
  onDraftChange: (value: string) => void;
  top: number;
  height: number;
  gridRowClassName: string;
  cellClassName: string;
  cellInputClassName: string;
  cellIndexClassName: string;
  addColumnCellClassName: string;
  skeletonBarClassName: string;
  filteredColumnIds?: Set<string>;
  sortedColumnIds?: Set<string>;
}

const GridRow = React.memo(function GridRow({
  tableRow,
  row,
  columns,
  rowGridCols,
  globalIndex,
  isLoaded,
  editingState,
  onStartEditing,
  onSaveCell,
  onCellKeyDown,
  onContextMenu,
  onDraftChange,
  top,
  height,
  gridRowClassName,
  cellClassName,
  cellInputClassName,
  cellIndexClassName,
  addColumnCellClassName,
  skeletonBarClassName,
  filteredColumnIds,
  sortedColumnIds,
}: GridRowProps) {
  return (
    <div
      className={gridRowClassName}
      style={{
        position: "absolute",
        top,
        left: 0,
        height: `${height}px`,
        width: "max-content",
        display: "grid",
        gridTemplateColumns: rowGridCols,
      }}
      onContextMenu={(e) => {
        if (!isLoaded) return;
        e.preventDefault();
        onContextMenu(row.id, e);
      }}
    >
      <div className={cellIndexClassName} style={isLoaded ? undefined : { opacity: 0.4 }}>
        <span>{globalIndex + 1}</span>
      </div>
      {isLoaded ? (
        tableRow.getVisibleCells().map((cell, colIndex) => {
          const col = columns[colIndex];
          if (!col) return null;
          const columnId = col.id;
          const columnType = col.type;
          const isEditing = editingState?.columnId === columnId;
          const displayValue = cell.getValue() as string;
          const isFilteredColumn = filteredColumnIds?.has(columnId);
          const isSortedColumn = sortedColumnIds?.has(columnId);
          const cellHighlightClass = isFilteredColumn ? s.cellFiltered : isSortedColumn ? s.cellSorted : "";
          return (
            <div
              key={cell.id}
              className={cellHighlightClass ? `${cellClassName} ${cellHighlightClass}` : cellClassName}
              onClick={() => !isEditing && onStartEditing(row.id, columnId, displayValue)}
            >
              {isEditing ? (
                <input
                  type={columnType === "NUMBER" ? "number" : "text"}
                  className={cellInputClassName}
                  value={editingState.draftValue}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onBlur={() => onSaveCell(row.id, columnId, columnType)}
                  onKeyDown={(e) =>
                    onCellKeyDown(e, row.id, columnId, columnType, globalIndex, colIndex)
                  }
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                flexRender(cell.column.columnDef.cell as React.ComponentType<{ context: unknown }>, cell.getContext())
              )}
            </div>
          );
        })
      ) : (
        columns.map((col, ci) => {
          const isFiltered = filteredColumnIds?.has(col.id);
          const isSorted = sortedColumnIds?.has(col.id);
          const cellHighlightClass = isFiltered ? s.cellFiltered : isSorted ? s.cellSorted : "";
          return (
            <div key={col.id} className={cellHighlightClass ? `${cellClassName} ${cellHighlightClass}` : cellClassName}>
              <div className={skeletonBarClassName} style={{ width: `${30 + ((globalIndex + ci) * 17) % 40}%`, height: 10 }} />
            </div>
          );
        })
      )}
      <div className={addColumnCellClassName} />
    </div>
  );
});

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

  const utils = trpc.useUtils();
  const { data: base } = trpc.base.getById.useQuery(
    { id: baseId! },
    {
      enabled: !!baseId,
      placeholderData: () => utils.base.list.getData()?.find((b) => b.id === baseId) ?? undefined,
    }
  );

  const { data: table, status: tableStatus } = trpc.table.getById.useQuery(
    { id: tableId! },
    { enabled: !!tableId }
  );

  const allTables = base?.tables ?? [];

  const { data: views = [], status: viewsStatus } = trpc.view.listByTableId.useQuery(
    { tableId: tableId! },
    { enabled: !!tableId }
  );
  const viewsReady = viewsStatus === "success" || viewsStatus === "error";

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
    const filterLogicalOperator: "AND" | "OR" = (activeView as { filterLogicalOperator?: string | null } | undefined)?.filterLogicalOperator === "OR" ? "OR" : "AND";
    let filters: { columnId: string; operator: "EQUALS" | "CONTAINS" | "IS_EMPTY" | "IS_NOT_EMPTY" | "NOT_CONTAINS" | "GREATER_THAN" | "LESS_THAN"; value?: string | null }[] | undefined;
    if (activeView?.filters?.length) {
      filters = activeView.filters.map((f) => ({
        columnId: f.columnId,
        operator: f.operator,
        value: f.value ?? undefined,
      }));
    } else if (!activeView && urlStatus && statusColumn) {
      filters = [{ columnId: statusColumn.id, operator: "EQUALS" as const, value: urlStatus }];
    }
    const sortsFromView =
      activeView?.sorts?.length
        ? activeView.sorts
            .slice()
            .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
            .map((s) => ({
              columnId: s.columnId,
              direction: s.direction.toLowerCase() as "asc" | "desc",
            }))
        : undefined;
    const sortsFromOverride = sortOverride
      ? [{ columnId: sortOverride.columnId, direction: sortOverride.direction }]
      : undefined;
    const sorts = activeView ? sortsFromView : sortsFromOverride;
    return {
      tableId,
      limit: PAGE_SIZE,
      searchQuery,
      filters,
      filterLogicalOperator,
      sorts: sorts?.length ? sorts : undefined,
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

  const filterButtonLabel = useMemo(() => {
    if (!activeView?.filters?.length) return "Filter";
    const names = (activeView.filters ?? []).map((f) => table?.columns?.find((c) => c.id === f.columnId)?.name ?? "").filter(Boolean).join(", ");
    return "Filtered by " + (names || "filters");
  }, [activeView?.filters, table?.columns]);

  const filteredColumnIds = useMemo(
    () => new Set((activeView?.filters ?? []).map((f) => f.columnId)),
    [activeView?.filters]
  );

  const sortedColumnIds = useMemo(
    () => new Set(listInput?.sorts?.map((s) => s.columnId) ?? []),
    [listInput?.sorts]
  );

  const sortButtonLabel = useMemo(() => {
    const n = listInput?.sorts?.length ?? 0;
    if (n === 0) return null;
    return n === 1 ? "Sorted by 1 field" : `Sorted by ${n} fields`;
  }, [listInput?.sorts?.length]);

  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showCreateViewModal, setShowCreateViewModal] = useState(false);
  const [viewMenuOpenId, setViewMenuOpenId] = useState<string | null>(null);
  const [viewMenuSource, setViewMenuSource] = useState<"sidebar" | "header" | null>(null);
  const viewMenuButtonRef = useRef<HTMLElement | null>(null);
  const viewMenuDropdownRef = useRef<HTMLDivElement | null>(null);
  const headerViewNameRef = useRef<HTMLDivElement | null>(null);
  const [viewRenamingId, setViewRenamingId] = useState<string | null>(null);
  const [viewRenameDraft, setViewRenameDraft] = useState("");
  const [viewRenameSource, setViewRenameSource] = useState<"sidebar" | "header" | null>(null);
  const viewRenameInputRef = useRef<HTMLInputElement | null>(null);
  const headerViewRenameInputRef = useRef<HTMLInputElement | null>(null);
  const viewClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewClickRef = useRef<{ id: string; time: number } | null>(null);
  const headerViewClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeaderViewClickRef = useRef<{ id: string; time: number } | null>(null);
  const [tableMenuOpenId, setTableMenuOpenId] = useState<string | null>(null);
  const [tableMenuMode, setTableMenuMode] = useState<"actions" | "rename">("actions");
  const [tableRenameDraft, setTableRenameDraft] = useState("");
  const tableRenameInputRef = useRef<HTMLInputElement | null>(null);
  const tableMenuAnchorRef = useRef<HTMLElement | null>(null);
  const tableMenuDropdownRef = useRef<HTMLDivElement | null>(null);
  const [baseRenameOpen, setBaseRenameOpen] = useState(false);
  const [baseRenameDraft, setBaseRenameDraft] = useState("");
  const baseRenameInputRef = useRef<HTMLInputElement | null>(null);
  const baseNameWrapRef = useRef<HTMLDivElement | null>(null);
  const baseRenameDropdownRef = useRef<HTMLDivElement | null>(null);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [sortSearchQuery, setSortSearchQuery] = useState("");
  const [showAddSortFieldPanel, setShowAddSortFieldPanel] = useState(false);
  const [addSortSearchQuery, setAddSortSearchQuery] = useState("");
  const [hideFieldsOpen, setHideFieldsOpen] = useState(false);
  const [columnSearchQuery, setColumnSearchQuery] = useState("");
  type FilterCondition = { columnId: string; operator: string; value: string };
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogicalOperator, setFilterLogicalOperator] = useState<"AND" | "OR">("AND");
  const lastAppliedFilterRef = useRef<string | null>(null);
  const pendingFilterUpdateRef = useRef<{
    id: string;
    filters: { columnId: string; operator: "IS_EMPTY" | "IS_NOT_EMPTY" | "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "GREATER_THAN" | "LESS_THAN"; value: string | null }[];
    filterLogicalOperator: "AND" | "OR";
  } | null>(null);

  const filterDropdownPrevOpenRef = useRef(false);
  const filterDropdownPrevViewIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!filterDropdownOpen) {
      lastAppliedFilterRef.current = null;
      filterDropdownPrevOpenRef.current = false;
    }
  }, [filterDropdownOpen]);


  // Sync from activeView only when dropdown just opened or user switched to a different view.
  // This avoids overwriting the user's "Match any" choice when optimistic update or refetch updates activeView.
  useEffect(() => {
    if (!filterDropdownOpen || !activeView) return;
    const justOpened = filterDropdownOpen && !filterDropdownPrevOpenRef.current;
    const viewIdChanged = filterDropdownPrevViewIdRef.current !== activeView.id;
    filterDropdownPrevOpenRef.current = filterDropdownOpen;
    filterDropdownPrevViewIdRef.current = activeView.id;
    if (!justOpened && !viewIdChanged) return;

    const op = (activeView as { filterLogicalOperator?: string | null }).filterLogicalOperator === "OR" ? "OR" : "AND";
    setFilterLogicalOperator(op);
    if (activeView.filters?.length) {
      setFilterConditions(
        activeView.filters.map((f) => ({
          columnId: f.columnId,
          operator: f.operator,
          value: f.value ?? "",
        }))
      );
      // Mark current server state as "last applied" so we don't send a redundant update when the debounced apply runs.
      const built = activeView.filters
        .map((f) => {
          const needsVal = NUMBER_FILTER_OPERATORS.find((o) => o.value === f.operator)?.needsValue ??
            TEXT_FILTER_OPERATORS.find((o) => o.value === f.operator)?.needsValue;
          const value = needsVal ? (f.value ?? "").trim() || "" : "";
          if (needsVal && !value) return null;
          return { columnId: f.columnId, operator: f.operator, value: needsVal ? value || null : null };
        })
        .filter((f): f is NonNullable<typeof f> => f != null);
      lastAppliedFilterRef.current = JSON.stringify({ filters: built, filterLogicalOperator: op });
    } else {
      setFilterConditions([]);
      lastAppliedFilterRef.current = JSON.stringify({ filters: [], filterLogicalOperator: op });
    }
  }, [filterDropdownOpen, activeView?.id, activeView?.filters, (activeView as { filterLogicalOperator?: string | null } | undefined)?.filterLogicalOperator]);

  const filterApplyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          if (input.filterLogicalOperator !== undefined) {
            (updated as { filterLogicalOperator?: string | null }).filterLogicalOperator = input.filterLogicalOperator;
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
    onError: (err, _input, context) => {
      if (tableId && context?.previous) {
        utils.view.listByTableId.setData({ tableId }, context.previous);
      }
      const msg = err?.message ?? "Failed to update view";
      const hint = /filterLogicalOperator|Unknown column|does not exist/i.test(String(msg))
        ? " Run: npx prisma migrate deploy"
        : "";
      toast.error(msg + hint);
    },
    onSettled: () => {
      if (tableId) {
        void utils.view.listByTableId.invalidate({ tableId });
      }
      if (pendingFilterUpdateRef.current) {
        const next = pendingFilterUpdateRef.current;
        pendingFilterUpdateRef.current = null;
        updateView.mutate(next);
      }
    },
  });

  const createView = trpc.view.create.useMutation({
    onSuccess: () => {
      if (tableId) void utils.view.listByTableId.invalidate({ tableId });
    },
    onError: (err) => toast.error(err?.message ?? "Failed to create view"),
  });

  const deleteView = trpc.view.delete.useMutation({
    onSuccess: () => {
      if (tableId) void utils.view.listByTableId.invalidate({ tableId });
    },
    onError: (err) => toast.error(err?.message ?? "Failed to delete view"),
  });

  const updateTable = trpc.table.update.useMutation({
    onSuccess: () => {
      if (baseId) void utils.base.getById.invalidate({ id: baseId });
    },
    onError: (err) => toast.error(err?.message ?? "Failed to rename table"),
  });

  const updateBase = trpc.base.update.useMutation({
    onSuccess: () => {
      if (baseId) {
        void utils.base.getById.invalidate({ id: baseId });
        void utils.base.list.invalidate();
      }
    },
    onError: (err) => toast.error(err?.message ?? "Failed to rename base"),
  });

  const deleteTable = trpc.table.delete.useMutation({
    onMutate: async ({ id }) => {
      if (!baseId) return undefined;
      await utils.base.getById.cancel({ id: baseId });
      const previous = utils.base.getById.getData({ id: baseId });
      utils.base.getById.setData({ id: baseId }, (old) => {
        if (!old) return old;
        return { ...old, tables: old.tables.filter((tab) => tab.id !== id) };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (baseId && context?.previous) {
        utils.base.getById.setData({ id: baseId }, context.previous);
      }
      toast.error(err?.message ?? "Failed to delete table");
    },
    onSettled: () => {
      if (baseId) void utils.base.getById.invalidate({ id: baseId });
    },
  });

  useEffect(() => {
    if (viewMenuOpenId == null) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        viewMenuDropdownRef.current?.contains(target) ||
        viewMenuButtonRef.current?.contains(target)
      ) return;
      setViewMenuOpenId(null);
      setViewMenuSource(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setViewMenuOpenId(null);
        setViewMenuSource(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [viewMenuOpenId]);

  useEffect(() => {
    if (tableMenuOpenId == null) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        tableMenuDropdownRef.current?.contains(target) ||
        tableMenuAnchorRef.current?.contains(target)
      ) return;
      setTableMenuOpenId(null);
      setTableMenuMode("actions");
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setTableMenuOpenId(null);
        setTableMenuMode("actions");
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [tableMenuOpenId]);

  useEffect(() => {
    if (tableMenuOpenId == null) return;
    setTableMenuMode("actions");
  }, [tableMenuOpenId]);

  useEffect(() => {
    if (tableMenuMode !== "rename" || !tableMenuOpenId) return;
    tableRenameInputRef.current?.focus();
    tableRenameInputRef.current?.select();
  }, [tableMenuMode, tableMenuOpenId]);

  useEffect(() => {
    if (!baseRenameOpen) return;
    baseRenameInputRef.current?.focus();
    baseRenameInputRef.current?.select();
  }, [baseRenameOpen]);

  useEffect(() => {
    if (!baseRenameOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        baseRenameDropdownRef.current?.contains(target) ||
        baseNameWrapRef.current?.contains(target)
      ) return;
      setBaseRenameOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBaseRenameOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [baseRenameOpen]);

  useEffect(() => {
    if (viewRenamingId == null) return;
    const input = viewRenameSource === "header" ? headerViewRenameInputRef.current : viewRenameInputRef.current;
    input?.focus();
    input?.select();
  }, [viewRenamingId, viewRenameSource]);

  const startViewRename = useCallback((v: { id: string; name: string }, source: "sidebar" | "header" = "sidebar") => {
    setViewMenuOpenId(null);
    setViewMenuSource(null);
    setViewRenamingId(v.id);
    setViewRenameDraft(v.name);
    setViewRenameSource(source);
  }, []);

  const applyFilterFromForm = useCallback(() => {
    if (!activeView?.id) return;
    const built = filterConditions
      .map((c) => {
        const needsVal = NUMBER_FILTER_OPERATORS.find((o) => o.value === c.operator)?.needsValue ??
          TEXT_FILTER_OPERATORS.find((o) => o.value === c.operator)?.needsValue;
        const value = needsVal ? c.value.trim() || "" : "";
        if (needsVal && !value) return null;
        return {
          columnId: c.columnId,
          operator: c.operator as "IS_EMPTY" | "IS_NOT_EMPTY" | "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "GREATER_THAN" | "LESS_THAN",
          value: needsVal ? value || null : null,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
    const payloadKey = JSON.stringify({ filters: built, filterLogicalOperator });
    if (lastAppliedFilterRef.current === payloadKey) return;
    lastAppliedFilterRef.current = payloadKey;
    const payload = { id: activeView.id, filters: built, filterLogicalOperator };
    if (updateView.isPending) {
      pendingFilterUpdateRef.current = payload;
      return;
    }
    pendingFilterUpdateRef.current = null;
    updateView.mutate(payload);
  }, [activeView?.id, filterConditions, filterLogicalOperator, updateView]);

  useEffect(() => {
    if (!filterDropdownOpen || !activeView?.id) return;
    if (filterApplyDebounceRef.current) clearTimeout(filterApplyDebounceRef.current);
    filterApplyDebounceRef.current = setTimeout(() => {
      applyFilterFromForm();
      filterApplyDebounceRef.current = null;
    }, 300);
    return () => {
      if (filterApplyDebounceRef.current) clearTimeout(filterApplyDebounceRef.current);
    };
  }, [filterDropdownOpen, activeView?.id, filterConditions, filterLogicalOperator, applyFilterFromForm]);

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
    const hideable = allTableColumns.filter((c) => c.name !== "Name");
    const q = columnSearchQuery.trim().toLowerCase();
    if (!q) return hideable;
    return hideable.filter((c) => c.name.toLowerCase().includes(q));
  }, [allTableColumns, columnSearchQuery]);

  useEffect(() => {
    if (!sortDropdownOpen) {
      setSortSearchQuery("");
      setShowAddSortFieldPanel(false);
      setAddSortSearchQuery("");
    }
  }, [sortDropdownOpen]);

  const filteredColumnsForSort = useMemo(() => {
    const q = sortSearchQuery.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.name.toLowerCase().includes(q));
  }, [columns, sortSearchQuery]);

  const currentSorts = useMemo(() => {
    if (activeView?.sorts?.length) {
      return activeView.sorts
        .slice()
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
        .map((s) => ({ columnId: s.columnId, direction: s.direction }));
    }
    if (sortOverride) {
      return [{ columnId: sortOverride.columnId, direction: sortOverride.direction.toUpperCase() as "ASC" | "DESC" }];
    }
    return [];
  }, [activeView?.sorts, sortOverride]);

  const sortedColumnIdsSet = useMemo(() => new Set(currentSorts.map((s) => s.columnId)), [currentSorts]);
  const columnsAvailableForAddSort = useMemo(
    () => columns.filter((c) => !sortedColumnIdsSet.has(c.id)),
    [columns, sortedColumnIdsSet]
  );
  const filteredColumnsForAddSort = useMemo(() => {
    const q = addSortSearchQuery.trim().toLowerCase();
    if (!q) return columnsAvailableForAddSort;
    return columnsAvailableForAddSort.filter((c) => c.name.toLowerCase().includes(q));
  }, [columnsAvailableForAddSort, addSortSearchQuery]);

  const hiddenFieldCount = useMemo(() => {
    return allTableColumns.filter(
      (c) => c.name !== "Name" && !(visibilityByColumnId.get(c.id) ?? true)
    ).length;
  }, [allTableColumns, visibilityByColumnId]);

  const updateSorts = useCallback(
    (newSorts: { columnId: string; direction: "ASC" | "DESC" }[]) => {
      if (activeView?.id) {
        updateView.mutate({
          id: activeView.id,
          sorts: newSorts.map((s, i) => ({ columnId: s.columnId, direction: s.direction, priority: i })),
        });
      } else {
        const first = newSorts[0];
        setSortOverride(
          first
            ? { columnId: first.columnId, direction: first.direction.toLowerCase() as "asc" | "desc" }
            : null
        );
      }
    },
    [activeView?.id, updateView]
  );

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

  const handleHideAllColumns = useCallback(() => {
    if (!activeView?.id) return;
    const nextVisibility = allTableColumns.map((col, position) => ({
      columnId: col.id,
      visible: col.name === "Name",
      position,
    }));
    updateView.mutate({ id: activeView.id, columnVisibility: nextVisibility });
  }, [activeView?.id, allTableColumns, updateView]);

  const handleShowAllColumns = useCallback(() => {
    if (!activeView?.id) return;
    const nextVisibility = allTableColumns.map((col, position) => ({
      columnId: col.id,
      visible: true,
      position,
    }));
    updateView.mutate({ id: activeView.id, columnVisibility: nextVisibility });
  }, [activeView?.id, allTableColumns, updateView]);

  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const countInput = useMemo(() => {
    if (!tableId) return undefined;
    return {
      tableId,
      searchQuery: listInput?.searchQuery,
      filters: listInput?.filters,
      filterLogicalOperator: (listInput?.filterLogicalOperator ?? "AND") as "AND" | "OR",
    };
  }, [tableId, listInput?.searchQuery, listInput?.filters, listInput?.filterLogicalOperator]);

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
          sorts: listInput.sorts,
          filters: listInput.filters,
          filterLogicalOperator: listInput.filterLogicalOperator,
        });
        // Only apply result if we're still on the same view/sort (avoid flicker when switching views quickly)
        if (cacheGeneration.current !== currentGen) return;
        pageCache.current.set(pageNum, data.rows as RowType[]);
        pageFetchGen.current.set(pageNum, currentGen);
        setInitialLoading(false);
        setCacheVersion((v) => v + 1);
      } catch {
        if (cacheGeneration.current !== currentGen) return;
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
      if (!countInput || !tableId) return;
      const prev = utils.row.count.getData(countInput);
      utils.row.count.setData(countInput, (old) =>
        old ? { count: old.count + 1 } : old
      );
      const newIndex = totalRowCount;
      const optimisticId = `optimistic-${Date.now()}`;
      const hasFilterOrSearch = !!(listInput?.searchQuery?.trim() || (listInput?.filters?.length ?? 0));
      if (!hasFilterOrSearch && columns.length > 0) {
        const optimisticRow: RowType = {
          id: optimisticId,
          tableId,
          index: newIndex,
          cells: columns.map((col) => ({
            id: `optimistic-cell-${col.id}`,
            rowId: optimisticId,
            columnId: col.id,
            textValue: col.type === "NUMBER" ? null : "",
            numberValue: null,
          })),
        };
        const pageNum = Math.floor(newIndex / PAGE_SIZE);
        const existing = pageCache.current.get(pageNum) ?? [];
        const newRows = [...existing];
        if (newIndex % PAGE_SIZE === newRows.length) {
          newRows.push(optimisticRow);
        } else {
          newRows.splice(newIndex % PAGE_SIZE, 0, optimisticRow);
        }
        pageCache.current.set(pageNum, newRows);
        setCacheVersion((v) => v + 1);
      }
      return { prev, optimisticId };
    },
    onError: (_err, _input, context) => {
      if (countInput && context?.prev) {
        utils.row.count.setData(countInput, context.prev);
      }
      if (context?.optimisticId) {
        for (const [pageNum, pageRows] of pageCache.current.entries()) {
          const filtered = pageRows.filter((r) => r.id !== context.optimisticId);
          if (filtered.length !== pageRows.length) {
            pageCache.current.set(pageNum, filtered);
            setCacheVersion((v) => v + 1);
            break;
          }
        }
      }
      toast.error("Failed to add row");
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
      toast.error("Failed to add rows — some may have been created");
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
    onError: () => toast.error("Failed to delete row"),
    onSettled: invalidateRows,
  });

  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const previousCellValueRef = useRef<string>("");
  const editingCellRef = useRef(editingCell);
  const draftValueRef = useRef(draftValue);
  useEffect(() => {
    editingCellRef.current = editingCell;
    draftValueRef.current = draftValue;
  });

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

  const handleRowContextMenu = useCallback((rowId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setRowContextMenu({ rowId, x: e.clientX, y: e.clientY });
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
      const newCell = {
        id: `local-${rowId}-${columnId}`,
        rowId,
        columnId,
        textValue: textVal,
        numberValue: numVal,
      };
      for (const [pageNum, pageRows] of pageCache.current.entries()) {
        const updated = pageRows.map((row) => {
          if (row.id !== rowId) return row;
          const existing = row.cells.find((c) => c.columnId === columnId);
          const cells = existing
            ? row.cells.map((c) =>
                c.columnId === columnId
                  ? { ...c, textValue: textVal, numberValue: numVal }
                  : c
              )
            : [...row.cells, newCell];
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
      const current = editingCellRef.current;
      const value = draftValueRef.current;
      if (!current || current.rowId !== rowId || current.columnId !== columnId) return;
      const isNumber = columnType === "NUMBER";
      if (isNumber) {
        const n = value.trim() === "" ? null : Number(value);
        if (n !== null && !Number.isFinite(n)) {
          cancelEditing();
          return;
        }
      }
      const previousValue = previousCellValueRef.current;
      applyCellToCache(rowId, columnId, columnType, value, isNumber);
      cancelEditing();
      const rollback = () => {
        applyCellToCache(rowId, columnId, columnType, previousValue, isNumber);
      };
      const onError = () => { rollback(); toast.error("Failed to save cell"); };
      if (isNumber) {
        updateCell.mutate(
          { rowId, columnId, numberValue: value.trim() === "" ? undefined : Number(value) },
          { onError }
        );
      } else {
        updateCell.mutate(
          { rowId, columnId, textValue: value.trim() || null },
          { onError }
        );
      }
    },
    [updateCell, cancelEditing, applyCellToCache]
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

  const baseColor = base ? getBaseColor(base.id) : "#e5e7eb";
  const pageTitle = table && base
    ? `${table.name} – ${base.name} – Airtable`
    : base
      ? `${base.name} – Airtable`
      : "Table – Airtable";

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <AppLayout bare>
        <div className={s.pageRow}>
          {/* ─── Left icon bar (always real) ─── */}
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
          {/* ─── Base header bar (only when base loaded – no skeleton) ─── */}
          {base && (
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
              <div
                ref={baseNameWrapRef}
                className={s.baseNameWrap}
              >
                <Link
                  href={`/bases/${baseId}`}
                  className={s.baseLink}
                  onClick={(e) => {
                    e.preventDefault();
                    setBaseRenameDraft(base.name);
                    setBaseRenameOpen(true);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setBaseRenameDraft(base.name);
                    setBaseRenameOpen(true);
                  }}
                >
                  {base.name}
                </Link>
                {baseRenameOpen && (
                  <div
                    ref={baseRenameDropdownRef}
                    className={s.baseRenameDropdown}
                  >
                    <div className={s.tableRenamePanel}>
                      <input
                        ref={baseRenameInputRef}
                        type="text"
                        className={s.tableRenameInput}
                        value={baseRenameDraft}
                        onChange={(e) => setBaseRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const name = baseRenameDraft.trim();
                            if (name && name !== base.name) {
                              updateBase.mutate({ id: base.id, name });
                              setBaseRenameOpen(false);
                            }
                          }
                        }}
                        placeholder="Base name"
                        aria-label="Base name"
                      />
                      <div className={s.tableRenameActions}>
                        <button
                          type="button"
                          className={s.tableRenameCancel}
                          onClick={() => setBaseRenameOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={s.tableRenameSave}
                          onClick={() => {
                            const name = baseRenameDraft.trim();
                            if (name && name !== base.name) {
                              updateBase.mutate({ id: base.id, name });
                              setBaseRenameOpen(false);
                            }
                          }}
                          disabled={!baseRenameDraft.trim() || baseRenameDraft.trim() === base.name}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className={s.chevronBtn} aria-label="Base menu">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" /></svg>
              </button>
              <div className={s.headerRight} />
            </div>
          )}

          {/* ─── Table tabs row (only when base loaded – no skeleton) ─── */}
          {base && (
            <div
              className={`${s.tableTabsRow} ${tableMenuOpenId ? s.tableTabsRowMenuOpen : ""}`}
              style={{ background: `color-mix(in srgb, ${baseColor} 8%, #fff)` }}
            >
              {allTables.map((t) => (
                <div
                  key={t.id}
                  className={s.tableTabWrap}
                  ref={tableMenuOpenId === t.id ? tableMenuAnchorRef as React.RefObject<HTMLDivElement> : null}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    tableMenuAnchorRef.current = e.currentTarget;
                    setTableMenuOpenId(t.id);
                  }}
                >
                  {t.id === tableId ? (
                    <button
                      type="button"
                      className={s.tableTabActive}
                      onClick={() => setTableMenuOpenId(t.id)}
                    >
                      {t.name}
                    </button>
                  ) : (
                    <Link
                      href={`/bases/${baseId}/tables/${t.id}`}
                      className={s.tableTab}
                    >
                      {t.name}
                    </Link>
                  )}
                  {tableMenuOpenId === t.id && (
                    <div ref={tableMenuDropdownRef} className={`${s.viewItemDropdown} ${s.viewItemDropdownFromLeft} ${tableMenuMode === "rename" ? s.tableRenameDropdown : ""}`}>
                      {tableMenuMode === "rename" ? (
                        <div className={s.tableRenamePanel}>
                          <input
                            ref={tableRenameInputRef}
                            type="text"
                            className={s.tableRenameInput}
                            value={tableRenameDraft}
                            onChange={(e) => setTableRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const name = tableRenameDraft.trim();
                                if (name && name !== t.name) {
                                  updateTable.mutate({ id: t.id, name });
                                  setTableMenuOpenId(null);
                                  setTableMenuMode("actions");
                                }
                              }
                            }}
                            placeholder="Table name"
                            aria-label="Table name"
                          />
                          <div className={s.tableRenameActions}>
                            <button
                              type="button"
                              className={s.tableRenameCancel}
                              onClick={() => setTableMenuMode("actions")}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={s.tableRenameSave}
                              onClick={() => {
                                const name = tableRenameDraft.trim();
                                if (name && name !== t.name) {
                                  updateTable.mutate({ id: t.id, name });
                                  setTableMenuOpenId(null);
                                  setTableMenuMode("actions");
                                }
                              }}
                              disabled={!tableRenameDraft.trim() || tableRenameDraft.trim() === t.name}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={s.viewItemDropdownItem}
                            onClick={() => {
                              setTableRenameDraft(t.name);
                              setTableMenuMode("rename");
                            }}
                          >
                            Rename table
                          </button>
                          <button
                            type="button"
                            className={s.viewItemDropdownItemDanger}
                            onClick={() => {
                              const wasCurrent = t.id === tableId;
                              const nextTable = allTables.filter((x) => x.id !== t.id)[0];
                              deleteTable.mutate(
                                { id: t.id },
                                {
                                  onSuccess: () => {
                                    setTableMenuOpenId(null);
                                    setTableMenuMode("actions");
                                  },
                                }
                              );
                              setTableMenuOpenId(null);
                              setTableMenuMode("actions");
                              if (wasCurrent) {
                                if (nextTable) void router.push(`/bases/${baseId}/tables/${nextTable.id}`);
                                else void router.push(`/bases/${baseId}`);
                              }
                            }}
                          >
                            Delete table
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
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
          )}

          {tableStatus === "error" ? (
            <div className={s.errorBlock} style={{ flex: 1, padding: 48 }}>
              <p className={s.mutedText}>Table not found.</p>
              <Link href={`/bases/${baseId}`} className={s.primaryButton} style={{ textDecoration: "none" }}>
                Back to base
              </Link>
            </div>
          ) : !table || !viewsReady ? (
            <div className={s.tableLoadingState} aria-busy="true" aria-label="Loading table" />
          ) : (
            <>
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
            <div
              ref={headerViewNameRef}
              className={s.viewSidebarTitleWrap}
              onClick={() => {
                if (!activeView) return;
                if (viewRenamingId === activeView.id) return;
                const now = Date.now();
                const last = lastHeaderViewClickRef.current;
                if (last?.id === activeView.id && now - last.time < 400) {
                  if (headerViewClickTimeoutRef.current) clearTimeout(headerViewClickTimeoutRef.current);
                  headerViewClickTimeoutRef.current = null;
                  lastHeaderViewClickRef.current = null;
                  startViewRename(activeView, "header");
                  return;
                }
                lastHeaderViewClickRef.current = { id: activeView.id, time: now };
                if (headerViewClickTimeoutRef.current) clearTimeout(headerViewClickTimeoutRef.current);
                headerViewClickTimeoutRef.current = setTimeout(() => {
                  headerViewClickTimeoutRef.current = null;
                  lastHeaderViewClickRef.current = null;
                  viewMenuButtonRef.current = headerViewNameRef.current;
                  setViewMenuOpenId(activeView.id);
                  setViewMenuSource("header");
                }, 400);
              }}
            >
              <span className={s.viewSidebarTitle}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="rgb(22,110,225)" style={{shapeRendering: "geometricPrecision"}} aria-hidden="true">
                  <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM3.5 3a.5.5 0 0 0-.5.5V6h4V3H3.5ZM8 3v3h5V3.5a.5.5 0 0 0-.5-.5H8ZM3 7v2h4V7H3Zm5 0v2h5V7H8ZM3 10v2.5a.5.5 0 0 0 .5.5H7v-3H3Zm5 0v3h4.5a.5.5 0 0 0 .5-.5V10H8Z" />
                </svg>
                {viewRenamingId === activeView?.id ? (
                  <input
                    ref={headerViewRenameInputRef}
                    type="text"
                    className={s.viewItemRenameInput}
                    value={viewRenameDraft}
                    onChange={(e) => setViewRenameDraft(e.target.value)}
                    onBlur={() => {
                      if (!activeView) return;
                      const name = viewRenameDraft.trim();
                      if (name && name !== activeView.name) updateView.mutate({ id: activeView.id, name });
                      setViewRenamingId(null);
                      setViewRenameSource(null);
                    }}
                    onKeyDown={(e) => {
                      if (!activeView) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const name = viewRenameDraft.trim();
                        if (name && name !== activeView.name) updateView.mutate({ id: activeView.id, name });
                        setViewRenamingId(null);
                        setViewRenameSource(null);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setViewRenameDraft(activeView.name);
                        setViewRenamingId(null);
                        setViewRenameSource(null);
                      }
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  activeView?.name ?? "Grid view"
                )}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className={s.viewSidebarChevron}>
                  <path d="M4.47 5.97a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </span>
              {viewMenuOpenId === activeView?.id && viewMenuSource === "header" && activeView && (
                <div ref={viewMenuDropdownRef} className={`${s.viewItemDropdown} ${s.viewItemDropdownFromLeft}`}>
                  <button
                    type="button"
                    className={s.viewItemDropdownItem}
                    onClick={() => startViewRename(activeView, "header")}
                  >
                    Rename view
                  </button>
                  <button
                    type="button"
                    className={s.viewItemDropdownItem}
                    onClick={() => {
                      if (!tableId) return;
                      const flop = (activeView as { filterLogicalOperator?: string | null }).filterLogicalOperator;
                      createView.mutate(
                        { tableId, name: `${activeView.name} copy`, position: views.length },
                        {
                          onSuccess: (newView) => {
                            updateView.mutate(
                              {
                                id: newView.id,
                                filters: (activeView.filters ?? []).map((f, i) => ({ columnId: f.columnId, operator: f.operator, value: f.value ?? null, position: i })),
                                sorts: (activeView.sorts ?? []).map((s, i) => ({ columnId: s.columnId, direction: s.direction, priority: i })),
                                columnVisibility: (activeView.columnVisibility ?? []).map((c, i) => ({ columnId: c.columnId, visible: c.visible, position: c.position ?? i })),
                                ...(flop != null ? { filterLogicalOperator: flop as "AND" | "OR" } : {}),
                              },
                              {
                                onSuccess: () => {
                                  void utils.view.listByTableId.invalidate({ tableId });
                                  void router.push(
                                    { pathname: router.pathname, query: { ...router.query, view: newView.id } },
                                    undefined,
                                    { shallow: true }
                                  );
                                  setViewMenuOpenId(null);
                                  setViewMenuSource(null);
                                },
                              }
                            );
                          },
                        }
                      );
                    }}
                  >
                    Duplicate view
                  </button>
                  <button
                    type="button"
                    className={s.viewItemDropdownItemDanger}
                    onClick={() => {
                      deleteView.mutate(
                        { id: activeView.id },
                        {
                          onSuccess: () => {
                            setViewMenuOpenId(null);
                            setViewMenuSource(null);
                            const rest = views.filter((x) => x.id !== activeView.id);
                            const nextId = rest[0]?.id;
                            void router.push(
                              {
                                pathname: router.pathname,
                                query: nextId != null ? { ...router.query, view: nextId } : (() => { const q = { ...router.query }; delete q.view; return q; })(),
                              },
                              undefined,
                              { shallow: true }
                            );
                          },
                        }
                      );
                    }}
                  >
                    Delete view
                  </button>
                </div>
              )}
            </div>
            <div className={s.toolbarRight}>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={hiddenFieldCount > 0 ? s.toolbarBtnHiddenFields : s.toolbarBtn}
                    onClick={() => setHideFieldsOpen((o) => !o)}
                    aria-expanded={hideFieldsOpen}
                    aria-haspopup="dialog"
                    aria-label={hiddenFieldCount > 0 ? `${hiddenFieldCount} hidden fields` : "Hide fields"}
                  >
                    {hiddenFieldCount > 0 ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 4C4.5 4 2 8 2 8s2.5 4 6 4 6-4 6-4-2.5-4-6-4z" /><circle cx="8" cy="8" r="2.5" /><path d="M2 2l12 12" /></svg>
                        {hiddenFieldCount === 1 ? "1 hidden field" : `${hiddenFieldCount} hidden fields`}
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2.5l11 11" /><path d="M4.2 6.3C3.2 7 2.5 8 2.5 8s2.5 4 5.5 4c.8 0 1.6-.3 2.2-.6" /><path d="M11 10.4c1.3-.9 2-2.1 2.2-2.4-0-.1-2.5-4-5.2-4-.5 0-1 .1-1.5.3" /><circle cx="8" cy="8" r="2" /></svg>
                        Hide fields
                      </>
                    )}
                  </button>
                  {hideFieldsOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setHideFieldsOpen(false)}
                      />
                      <div className={s.hideFieldsDropdown} role="dialog" aria-label="Hide fields">
                        <div className={s.hideFieldsSearchWrap}>
                          <input
                            type="search"
                            className={s.hideFieldsSearch}
                            placeholder="Find a field"
                            value={columnSearchQuery}
                            onChange={(e) => setColumnSearchQuery(e.target.value)}
                            autoFocus
                            aria-label="Find a field"
                          />
                        </div>
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
                              <div key={col.id} className={s.hideFieldsRow}>
                                <label className={s.hideFieldsToggleWrap}>
                                  <input
                                    type="checkbox"
                                    className={s.hideFieldsToggle}
                                    checked={getColumnVisible(col.id)}
                                    onChange={() => handleToggleColumnVisibility(col.id)}
                                    disabled={updateView.isPending}
                                  />
                                  <span className={s.hideFieldsToggleTrack} aria-hidden />
                                </label>
                                <span className={s.hideFieldsLabel}>{col.name}</span>
                              </div>
                            ))
                          )}
                        </div>
                        <div className={s.hideFieldsFooter}>
                          <button type="button" className={s.hideFieldsFooterBtn} onClick={handleHideAllColumns} disabled={!activeView || updateView.isPending}>Hide all</button>
                          <button type="button" className={s.hideFieldsFooterBtn} onClick={handleShowAllColumns} disabled={!activeView || updateView.isPending}>Show all</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={activeView?.filters?.length ? s.toolbarBtnFilterActive : s.toolbarBtn}
                    onClick={() => setFilterDropdownOpen((o) => !o)}
                    aria-expanded={filterDropdownOpen}
                    aria-haspopup="dialog"
                    aria-label={filterButtonLabel}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M5 8h6M7 12h2" /></svg>
                    {filterButtonLabel}
                  </button>
                  {filterDropdownOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setFilterDropdownOpen(false)}
                      />
                      <div
                        className={`${s.filterDropdown} ${filterConditions.length > 0 ? s.filterDropdownWithCondition : ""}`}
                        role="dialog"
                        aria-label="Filter"
                      >
                        <h3 className={s.filterDropdownTitle}>Filter</h3>
                        {!activeView ? (
                          <div className={s.filterDropdownEmpty}>
                            Select a view to add a filter
                          </div>
                        ) : (
                          <>
                            <p className={s.filterDropdownStatus}>
                              {filterConditions.length === 0
                                ? "No filter conditions are applied"
                                : "In this view, show records"}
                            </p>
                            {filterConditions.map((cond, idx) => (
                              <div key={idx} className={s.filterConditionRow}>
                                {idx === 0 ? (
                                  <span className={s.filterConditionWhere}>Where</span>
                                ) : idx === 1 ? (
                                  <select
                                    className={`${s.filterDropdownSelectInline} ${s.filterConditionAndOr}`}
                                    value={filterLogicalOperator}
                                    onChange={(e) => setFilterLogicalOperator(e.target.value as "AND" | "OR")}
                                    aria-label="Combine with previous condition"
                                  >
                                    <option value="AND">and</option>
                                    <option value="OR">or</option>
                                  </select>
                                ) : (
                                  <span className={s.filterConditionWhere}>
                                    {filterLogicalOperator.toLowerCase()}
                                  </span>
                                )}
                                <select
                                  className={s.filterDropdownSelectInline}
                                  value={cond.columnId}
                                  onChange={(e) => {
                                    setFilterConditions((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx]!, columnId: e.target.value, operator: "CONTAINS", value: "" };
                                      return next;
                                    });
                                  }}
                                >
                                  {(table?.columns ?? []).map((col) => (
                                    <option key={col.id} value={col.id}>
                                      {col.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className={s.filterDropdownSelectInline}
                                  value={cond.operator}
                                  onChange={(e) => {
                                    setFilterConditions((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx]!, operator: e.target.value };
                                      return next;
                                    });
                                  }}
                                >
                                  {((table?.columns ?? []).find((c) => c.id === cond.columnId)?.type === "NUMBER"
                                    ? NUMBER_FILTER_OPERATORS
                                    : TEXT_FILTER_OPERATORS
                                  ).map((op) => (
                                    <option key={op.value} value={op.value}>
                                      {op.label}
                                    </option>
                                  ))}
                                </select>
                                {(NUMBER_FILTER_OPERATORS.find((o) => o.value === cond.operator)?.needsValue ??
                                  TEXT_FILTER_OPERATORS.find((o) => o.value === cond.operator)?.needsValue) ? (
                                  <input
                                    type={(table?.columns ?? []).find((c) => c.id === cond.columnId)?.type === "NUMBER" ? "number" : "text"}
                                    className={s.filterDropdownInputInline}
                                    value={cond.value}
                                    onChange={(e) => {
                                      setFilterConditions((prev) => {
                                        const next = [...prev];
                                        next[idx] = { ...next[idx]!, value: e.target.value };
                                        return next;
                                      });
                                    }}
                                    placeholder="Enter a value"
                                  />
                                ) : null}
                                <button
                                  type="button"
                                  className={s.filterConditionTrash}
                                  onClick={() => setFilterConditions((prev) => prev.filter((_, i) => i !== idx))}
                                  aria-label="Remove condition"
                                >
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M6 7v4M10 7v4M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" /></svg>
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className={s.filterDropdownAddLink}
                              onClick={() => {
                                const firstId = (table?.columns?.[0]?.id) ?? "";
                                setFilterConditions((prev) => [...prev, { columnId: firstId, operator: "CONTAINS", value: "" }]);
                              }}
                            >
                              + Add condition
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className={s.toolbarSortWrap}>
                  <button
                    type="button"
                    className={sortButtonLabel ? s.toolbarBtnSortActive : s.toolbarBtn}
                    onClick={() => setSortDropdownOpen((o) => !o)}
                    aria-expanded={sortDropdownOpen}
                    aria-haspopup="menu"
                    aria-label={sortButtonLabel ?? "Sort"}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6l4-4 4 4M4 10l4 4 4-4" /></svg>
                    {sortButtonLabel ?? "Sort"}
                  </button>
                  {sortDropdownOpen && (
                    <>
                      <div
                        className={s.viewSelectorBackdrop}
                        aria-hidden
                        onClick={() => setSortDropdownOpen(false)}
                      />
                      <div className={s.sortDropdown} role="menu" aria-label="Sort by">
                        {currentSorts.length === 0 ? (
                          <>
                            <div className={s.sortDropdownEmptyHeader}>
                              <h3 className={s.sortDropdownTitle}>Sort by</h3>
                            </div>
                            <div className={s.sortDropdownSearchWrap}>
                              <svg className={s.sortDropdownSearchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" />
                              </svg>
                              <input
                                type="search"
                                className={s.sortDropdownSearch}
                                placeholder="Find a field"
                                value={sortSearchQuery}
                                onChange={(e) => setSortSearchQuery(e.target.value)}
                                autoFocus
                                aria-label="Find a field"
                              />
                            </div>
                            <div className={s.sortDropdownList}>
                              {filteredColumnsForSort.map((col) => (
                                <button
                                  key={col.id}
                                  type="button"
                                  role="menuitem"
                                  className={s.sortDropdownColumnOption}
                                  onClick={() => updateSorts([{ columnId: col.id, direction: "ASC" }])}
                                >
                                  {col.name}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={s.sortDropdownTitleRow}>
                              <h3 className={s.sortDropdownTitle}>Sort by</h3>
                            </div>
                            <div className={s.sortDropdownDivider} />
                            <div className={s.sortDropdownRules}>
                              {currentSorts.map((sort, index) => {
                                const col = columns.find((c) => c.id === sort.columnId);
                                const isNumber = col?.type === "NUMBER";
                                return (
                                  <div key={`${sort.columnId}-${index}`} className={s.sortDropdownRuleRow}>
                                    <select
                                      className={s.sortDropdownFieldSelect}
                                      value={sort.columnId}
                                      onChange={(e) => {
                                        const next = currentSorts.slice();
                                        next[index] = { columnId: e.target.value, direction: sort.direction };
                                        updateSorts(next);
                                      }}
                                      aria-label="Sort field"
                                    >
                                      {columns.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>
                                    <select
                                      className={s.sortDropdownDirectionSelect}
                                      value={sort.direction}
                                      onChange={(e) => {
                                        const next = currentSorts.slice();
                                        next[index] = { columnId: sort.columnId, direction: e.target.value as "ASC" | "DESC" };
                                        updateSorts(next);
                                      }}
                                      aria-label="Sort order"
                                    >
                                      <option value="ASC">{isNumber ? "Low to high" : "A → Z"}</option>
                                      <option value="DESC">{isNumber ? "High to low" : "Z → A"}</option>
                                    </select>
                                    <button
                                      type="button"
                                      className={s.sortDropdownRemove}
                                      onClick={() => {
                                        const next = currentSorts.filter((_, i) => i !== index);
                                        updateSorts(next);
                                      }}
                                      aria-label="Remove sort"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            {activeView?.id && (
                              <>
                                <button
                                  type="button"
                                  className={s.sortDropdownAddAnother}
                                  onClick={() => setShowAddSortFieldPanel((v) => !v)}
                                >
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z" /></svg>
                                  Add another sort
                                </button>
                                {showAddSortFieldPanel && (
                                  <div className={s.sortDropdownFindField}>
                                    <div className={s.sortDropdownFindFieldTitle}>Find a field</div>
                                    <div className={s.sortDropdownSearchWrap}>
                                      <svg className={s.sortDropdownSearchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <circle cx="11" cy="11" r="8" />
                                        <path d="m21 21-4.35-4.35" />
                                      </svg>
                                      <input
                                        type="search"
                                        className={s.sortDropdownSearch}
                                        placeholder="Find a field"
                                        value={addSortSearchQuery}
                                        onChange={(e) => setAddSortSearchQuery(e.target.value)}
                                        autoFocus
                                        aria-label="Find a field"
                                      />
                                    </div>
                                    <div className={s.sortDropdownList}>
                                      {filteredColumnsForAddSort.length === 0 ? (
                                        <div className={s.sortDropdownNoFields}>No fields available</div>
                                      ) : (
                                        filteredColumnsForAddSort.map((col) => (
                                          <button
                                            key={col.id}
                                            type="button"
                                            role="menuitem"
                                            className={s.sortDropdownColumnOption}
                                            onClick={() => {
                                              updateSorts([...currentSorts, { columnId: col.id, direction: "ASC" }]);
                                              setShowAddSortFieldPanel(false);
                                              setAddSortSearchQuery("");
                                            }}
                                          >
                                            {col.name}
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
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
                  <div
                    key={v.id}
                    className={s.viewItemWrap}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      viewMenuButtonRef.current = e.currentTarget;
                      setViewMenuOpenId(v.id);
                      setViewMenuSource("sidebar");
                    }}
                  >
                    <button
                      type="button"
                      className={activeView?.id === v.id ? s.viewItemActive : s.viewItem}
                      onClick={() => {
                        if (viewRenamingId === v.id) return;
                        const now = Date.now();
                        const last = lastViewClickRef.current;
                        if (last?.id === v.id && now - last.time < 400) {
                          if (viewClickTimeoutRef.current) clearTimeout(viewClickTimeoutRef.current);
                          viewClickTimeoutRef.current = null;
                          lastViewClickRef.current = null;
                          startViewRename(v);
                          return;
                        }
                        lastViewClickRef.current = { id: v.id, time: now };
                        if (viewClickTimeoutRef.current) clearTimeout(viewClickTimeoutRef.current);
                        viewClickTimeoutRef.current = setTimeout(() => {
                          viewClickTimeoutRef.current = null;
                          lastViewClickRef.current = null;
                          void router.push(
                            { pathname: router.pathname, query: { ...router.query, view: v.id } },
                            undefined,
                            { shallow: true }
                          );
                        }, 400);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="rgb(22,110,225)" style={{shapeRendering: "geometricPrecision"}} className={s.viewItemIcon} aria-hidden="true">
                        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM3.5 3a.5.5 0 0 0-.5.5V6h4V3H3.5ZM8 3v3h5V3.5a.5.5 0 0 0-.5-.5H8ZM3 7v2h4V7H3Zm5 0v2h5V7H8ZM3 10v2.5a.5.5 0 0 0 .5.5H7v-3H3Zm5 0v3h4.5a.5.5 0 0 0 .5-.5V10H8Z" />
                      </svg>
                      {viewRenamingId === v.id ? (
                        <input
                          ref={viewRenameInputRef}
                          type="text"
                          className={s.viewItemRenameInput}
                          value={viewRenameDraft}
                          onChange={(e) => setViewRenameDraft(e.target.value)}
                          onBlur={() => {
                            const name = viewRenameDraft.trim();
                            if (name && name !== v.name) updateView.mutate({ id: v.id, name });
                            setViewRenamingId(null);
                            setViewRenameSource(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const name = viewRenameDraft.trim();
                              if (name && name !== v.name) updateView.mutate({ id: v.id, name });
                              setViewRenamingId(null);
                              setViewRenameSource(null);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setViewRenameDraft(v.name);
                              setViewRenamingId(null);
                              setViewRenameSource(null);
                            }
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        v.name
                      )}
                    </button>
                    <button
                      ref={viewMenuOpenId === v.id ? (viewMenuButtonRef as React.RefObject<HTMLButtonElement | null>) : null}
                      type="button"
                      className={s.viewItemGear}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (viewMenuOpenId === v.id) {
                          setViewMenuOpenId(null);
                          setViewMenuSource(null);
                        } else {
                          viewMenuButtonRef.current = e.currentTarget;
                          setViewMenuOpenId(v.id);
                          setViewMenuSource("sidebar");
                        }
                      }}
                      aria-label={`Options for ${v.name}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <circle cx="3" cy="8" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="13" cy="8" r="1.5" />
                      </svg>
                    </button>
                    {viewMenuOpenId === v.id && viewMenuSource === "sidebar" && (
                      <div ref={viewMenuDropdownRef} className={s.viewItemDropdown}>
                        <button
                          type="button"
                          className={s.viewItemDropdownItem}
                          onClick={() => startViewRename(v)}
                        >
                          Rename view
                        </button>
                        <button
                          type="button"
                          className={s.viewItemDropdownItem}
                          onClick={() => {
                            if (!tableId) return;
                            const flop = (v as { filterLogicalOperator?: string | null }).filterLogicalOperator;
                            createView.mutate(
                              { tableId, name: `${v.name} copy`, position: views.length },
                              {
                                onSuccess: (newView) => {
                                  updateView.mutate(
                                    {
                                      id: newView.id,
                                      filters: (v.filters ?? []).map((f, i) => ({ columnId: f.columnId, operator: f.operator, value: f.value ?? null, position: i })),
                                      sorts: (v.sorts ?? []).map((s, i) => ({ columnId: s.columnId, direction: s.direction, priority: i })),
                                      columnVisibility: (v.columnVisibility ?? []).map((c, i) => ({ columnId: c.columnId, visible: c.visible, position: c.position ?? i })),
                                      ...(flop != null ? { filterLogicalOperator: flop as "AND" | "OR" } : {}),
                                    },
                                    {
                                      onSuccess: () => {
                                        void utils.view.listByTableId.invalidate({ tableId });
                                        void router.push(
                                          { pathname: router.pathname, query: { ...router.query, view: newView.id } },
                                          undefined,
                                          { shallow: true }
                                        );
                                        setViewMenuOpenId(null);
                                        setViewMenuSource(null);
                                      },
                                    }
                                  );
                                },
                              }
                            );
                          }}
                        >
                          Duplicate view
                        </button>
                        <button
                          type="button"
                          className={s.viewItemDropdownItemDanger}
                          onClick={() => {
                            deleteView.mutate(
                              { id: v.id },
                              {
                                onSuccess: () => {
                                  setViewMenuOpenId(null);
                                  setViewMenuSource(null);
                                  if (activeView?.id === v.id) {
                                    const rest = views.filter((x) => x.id !== v.id);
                                    const nextId = rest[0]?.id;
                                    void router.push(
                                      {
                                        pathname: router.pathname,
                                        query: nextId != null ? { ...router.query, view: nextId } : (() => { const q = { ...router.query }; delete q.view; return q; })(),
                                      },
                                      undefined,
                                      { shallow: true }
                                    );
                                  }
                                },
                              }
                            );
                          }}
                        >
                          Delete view
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ─── Grid panel (grid + summary) ─── */}
            <div className={s.gridPanel} style={gridScrollStyle}>
              {/* ─── Grid ─── */}
              {initialLoading ? (
                <div className={s.tableLoadingState} aria-busy="true" aria-label="Loading rows">
                  <div className={s.tableLoadingSpinner} aria-hidden />
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
                      {headerGroup.headers.map((header, headerIndex) => {
                        const col = columns.find((c) => c.id === header.id);
                        if (!col) return null;
                        const columnId = col.id;
                        const isFirstDataColumn = headerIndex === 0;
                        const firstSort = listInput?.sorts?.[0];
                        const isSorted = firstSort?.columnId === columnId;
                        const sortDirection = firstSort?.direction;
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
                          setSortDropdownOpen(true);
                        };
                        const isFilteredColumn = filteredColumnIds.has(columnId);
                        const isSortedColumn = sortedColumnIds.has(columnId);
                        const headerSortClass = isFilteredColumn ? s.cellHeaderFiltered : isSortedColumn ? s.cellHeaderSorted : "";
                        return (
                          <div
                            key={header.id}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { if (!(e.target as HTMLElement).closest(`.${s.resizeHandle}`)) handleSortClick(); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSortClick(); } }}
                            className={headerSortClass ? `${s.cellHeader} ${headerSortClass} ${s.cellHeaderSortable}` : `${s.cellHeader} ${s.cellHeaderSortable}`}
                            style={isFirstDataColumn ? undefined : { position: "relative" }}
                            aria-label={`Sort by ${col.name}`}
                          >
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
                      existingColumnNames={columns.map((c) => c.name)}
                      onClose={() => setShowAddColumnModal(false)}
                    />
                  )}

                  {totalRowCount === 0 && !initialLoading && !debouncedSearch && !activeView?.filters?.length && (
                    <div className={s.emptyState}>
                      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 12, opacity: 0.35 }}>
                        <rect x="4" y="8" width="40" height="32" rx="4" stroke="#6b7280" strokeWidth="2" />
                        <line x1="4" y1="18" x2="44" y2="18" stroke="#6b7280" strokeWidth="2" />
                        <line x1="4" y1="28" x2="44" y2="28" stroke="#6b7280" strokeWidth="2" />
                        <line x1="18" y1="8" x2="18" y2="40" stroke="#6b7280" strokeWidth="2" />
                      </svg>
                      <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
                        No records yet
                      </p>
                      <button
                        type="button"
                        className={s.primaryButton}
                        style={{ marginTop: 10 }}
                        disabled={createRow.isPending}
                        onClick={() => createRow.mutate({ tableId: tableId! })}
                      >
                        Add first record
                      </button>
                    </div>
                  )}

                  {/* Virtual rows rendered via TanStack Table row model (memoized so only edited row re-renders on keystroke/nav) */}
                  <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                    {tableInstance.getRowModel().rows.map((tableRow, i) => {
                      const virtualRow = virtualRows[i];
                      if (!virtualRow) return null;
                      const row = tableRow.original as (typeof visibleData)[number];
                      const globalIndex = row._globalIndex;
                      const isLoaded = row._loaded;
                      const editingState =
                        editingCell?.rowId === row.id
                          ? { columnId: editingCell.columnId, draftValue }
                          : null;
                      return (
                        <GridRow
                          key={row.id}
                          tableRow={tableRow}
                          row={row}
                          columns={columns}
                          rowGridCols={rowGridCols}
                          globalIndex={globalIndex}
                          isLoaded={isLoaded}
                          editingState={editingState}
                          onStartEditing={startEditing}
                          onSaveCell={saveCell}
                          onCellKeyDown={handleCellKeyDown}
                          onContextMenu={handleRowContextMenu}
                          onDraftChange={setDraftValue}
                          top={virtualRow.start}
                          height={virtualRow.size}
                          gridRowClassName={s.gridRow ?? ""}
                          cellClassName={s.cell ?? ""}
                          cellInputClassName={s.cellInput ?? ""}
                          cellIndexClassName={s.cellIndex ?? ""}
                          addColumnCellClassName={s.addColumnCell ?? ""}
                          skeletonBarClassName={s.skeletonBar ?? ""}
                          filteredColumnIds={filteredColumnIds}
                          sortedColumnIds={sortedColumnIds}
                        />
                      );
                    })}
                  </div>

                  {/* Add row bar — same grid + sticky as data rows so it stays visible when scrolling */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={s.addRowBarRow}
                    style={{ display: "grid", gridTemplateColumns: rowGridCols }}
                    onClick={() => !createRow.isPending && !isThisTableAdding100k && createRow.mutate({ tableId: tableId! })}
                    onKeyDown={(e) => e.key === "Enter" && !createRow.isPending && !isThisTableAdding100k && createRow.mutate({ tableId: tableId! })}
                    aria-label="Add row"
                    aria-disabled={createRow.isPending || isThisTableAdding100k}
                  >
                    <div className={s.addRowBarIndex}>
                      <span className={s.addRowIcon}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                      </span>
                    </div>
                    <div className={s.addRowBarCell} />
                    <div className={s.addRowBarRest} />
                  </div>
                  {/* Spacer so last rows can be scrolled into view with breathing room (Airtable-style) */}
                  <div className={s.gridBottomSpacer} />
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
            </>
          )}
        </div>
        </div>
      </AppLayout>
    </>
  );
}
