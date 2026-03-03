import { z } from "zod";
import { ColumnType, FilterOperator, SortDirection } from "../../generated/prisma/client.js";

/** Use for Prisma DateTime fields (serialized as Date over the wire with superjson). */
export const dateSchema = z.date();

export const baseOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdById: z.string().nullable(),
  position: z.number(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const tableOutputSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const columnOutputSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  type: z.nativeEnum(ColumnType),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const rowOutputSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  index: z.number(),
  searchText: z.string(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const viewOutputSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  searchQuery: z.string().nullable(),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

/** Minimal column for nested view relations. */
const columnRefSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  type: z.nativeEnum(ColumnType),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

const viewFilterOutputSchema = z.object({
  id: z.string(),
  viewId: z.string(),
  columnId: z.string(),
  operator: z.nativeEnum(FilterOperator),
  value: z.string().nullable(),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  column: columnRefSchema,
});

const viewSortOutputSchema = z.object({
  id: z.string(),
  viewId: z.string(),
  columnId: z.string(),
  direction: z.nativeEnum(SortDirection),
  priority: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  column: columnRefSchema,
});

const viewColumnVisibilityOutputSchema = z.object({
  id: z.string(),
  viewId: z.string(),
  columnId: z.string(),
  visible: z.boolean(),
  position: z.number().nullable(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  column: columnRefSchema,
});

/** View as returned by view.update with filters, sorts, columnVisibility. */
export const viewWithRelationsOutputSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  searchQuery: z.string().nullable(),
  position: z.number(),
  createdById: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  filters: z.array(viewFilterOutputSchema),
  sorts: z.array(viewSortOutputSchema),
  columnVisibility: z.array(viewColumnVisibilityOutputSchema),
});
