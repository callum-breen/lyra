import { z } from "zod";
import { faker } from "@faker-js/faker";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { bulkDeleteResultSchema, rowOutputSchema } from "../schemas";
import { Prisma } from "../../../generated/prisma/client";
import { ColumnType, FilterOperator } from "../../../generated/prisma/client";
import { badRequest, notFound, toTRPCError } from "../errors";

const MAX_BATCH = 100_000;

// Pre-generated faker pools (created once at module load, reused for all bulk inserts).
// Using large pools gives high variety while keeping insertion 100% in SQL.
const FAKER_POOLS: Record<string, string[]> = {
  Name: Array.from({ length: 1000 }, () => faker.person.fullName()),
  Notes: Array.from({ length: 500 }, () => faker.lorem.sentence()),
  Assignee: Array.from({ length: 500 }, () => faker.person.fullName()),
  Owner: Array.from({ length: 500 }, () => faker.person.fullName()),
  Status: ["Backlog", "In Progress", "Blocked", "Done"],
  Attachments: Array.from({ length: 200 }, () => faker.helpers.arrayElement(["—", "", faker.system.fileName()])),
  Company: Array.from({ length: 500 }, () => faker.company.name()),
  Email: Array.from({ length: 1000 }, () => faker.internet.email()),
};
const DEFAULT_FAKER_POOL = Array.from({ length: 300 }, () => faker.lorem.words({ min: 1, max: 3 }));

const NUMBER_RANGES: Record<string, [number, number]> = {
  Priority: [1, 5],
  "Estimate (hrs)": [1, 40],
  Budget: [1000, 100000],
  Score: [0, 100],
};
const DEFAULT_NUMBER_RANGE: [number, number] = [0, 1000];

function sqlArrayLiteral(arr: string[]): string {
  return `ARRAY[${arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]`;
}

const cursorSchema = z
  .object({
    id: z.string().optional(),
    index: z.number().optional(),
    offset: z.number().int().min(0).optional(),
    sortValue: z.union([z.string(), z.number()]).nullable().optional(),
    sortId: z.string().optional(),
  })
  .optional();

const filterOperatorSchema = z.nativeEnum(FilterOperator);

const filterItemSchema = z.object({
  columnId: z.string(),
  operator: filterOperatorSchema,
  value: z.union([z.string(), z.number()]).nullable().optional(),
});
type FilterItem = z.infer<typeof filterItemSchema>;

const filterInput = z
  .object({
    columnId: z.string(),
    operator: filterOperatorSchema,
    value: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .optional();

const filtersInput = z.array(filterItemSchema).optional();
const filterLogicalOperatorSchema = z.enum(["AND", "OR"]).optional();

const sortInput = z
  .object({
    direction: z.enum(["asc", "desc"]).default("asc"),
    columnId: z.string().optional(),
  })
  .optional();

const sortItemSchema = z.object({
  direction: z.enum(["asc", "desc"]),
  columnId: z.string(),
});
const sortsInput = z.array(sortItemSchema).optional();

function buildOneFilterCondition(filter: FilterItem): Prisma.RowWhereInput | null {
  const { columnId, operator, value } = filter;
  const valueString =
    value == null ? null : typeof value === "string" ? value : String(value);
  const valueNumber =
    value == null
      ? null
      : typeof value === "number"
        ? value
        : Number.isFinite(Number(value))
          ? Number(value)
          : null;
  const cond: Prisma.RowWhereInput = {};
  switch (operator) {
    case FilterOperator.IS_EMPTY:
      cond.OR = [
        { cells: { none: { columnId } } },
        { cells: { some: { columnId, AND: [{ numberValue: null }, { OR: [{ textValue: null }, { textValue: "" }] }] } } },
      ];
      break;
    case FilterOperator.IS_NOT_EMPTY:
      cond.cells = { some: { columnId, OR: [{ numberValue: { not: null } }, { AND: [{ textValue: { not: null } }, { NOT: { textValue: "" } }] }] } };
      break;
    case FilterOperator.CONTAINS:
      if (valueString?.trim()) cond.cells = { some: { columnId, textValue: { contains: valueString.trim(), mode: "insensitive" } } };
      else return null;
      break;
    case FilterOperator.NOT_CONTAINS:
      if (valueString?.trim()) cond.cells = { none: { columnId, textValue: { contains: valueString.trim(), mode: "insensitive" } } };
      else return null;
      break;
    case FilterOperator.EQUALS: {
      if (value == null) return null;
      const or: Prisma.CellWhereInput[] = [];
      if (valueString != null) or.push({ textValue: valueString });
      if (valueNumber != null) or.push({ numberValue: valueNumber });
      if (or.length) cond.cells = { some: { columnId, OR: or } };
      else return null;
      break;
    }
    case FilterOperator.GREATER_THAN:
      if (valueNumber != null) cond.cells = { some: { columnId, numberValue: { gt: valueNumber } } };
      else return null;
      break;
    case FilterOperator.LESS_THAN:
      if (valueNumber != null) cond.cells = { some: { columnId, numberValue: { lt: valueNumber } } };
      else return null;
      break;
    default:
      return null;
  }
  return Object.keys(cond).length ? cond : null;
}

function buildPrismaWhere(
  tableId: string,
  searchQuery?: string,
  filter?: z.infer<typeof filterInput>,
  filters?: FilterItem[],
  filterLogicalOperator?: "AND" | "OR",
): Prisma.RowWhereInput {
  const where: Prisma.RowWhereInput = { tableId };
  if (searchQuery?.trim()) {
    where.searchText = { contains: searchQuery.trim(), mode: "insensitive" };
  }
  const op = filterLogicalOperator ?? "AND";
  if (filters && filters.length > 0) {
    const conditions = filters.map(buildOneFilterCondition).filter((c): c is Prisma.RowWhereInput => c != null);
    if (conditions.length === 0) return where;
    if (conditions.length === 1) Object.assign(where, conditions[0]);
    else where[op] = conditions;
    return where;
  }
  if (!filter) return where;
  const one = buildOneFilterCondition({ columnId: filter.columnId, operator: filter.operator, value: filter.value });
  if (one) Object.assign(where, one);
  return where;
}

async function buildSqlFilterFragments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tableId: string,
  filter?: z.infer<typeof filterInput>,
) {
  let filterJoinFragment = Prisma.empty;
  let filterWhereFragment = Prisma.empty;
  if (!filter) return { filterJoinFragment, filterWhereFragment };

  const { columnId: filterColumnId, operator, value } = filter;
  const valueStr = value == null ? null : typeof value === "string" ? value : String(value);
  const valueNum =
    value == null ? null : typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : null;
  const filterColumn = await db.column.findUnique({ where: { id: filterColumnId }, select: { tableId: true, type: true } });
  if (!filterColumn || filterColumn.tableId !== tableId) return { filterJoinFragment, filterWhereFragment };

  filterJoinFragment = Prisma.sql`LEFT JOIN "Cell" c_filter ON c_filter."rowId" = r.id AND c_filter."columnId" = ${filterColumnId}`;
  switch (operator) {
    case FilterOperator.IS_EMPTY:
      filterWhereFragment = Prisma.sql`AND (c_filter.id IS NULL OR (c_filter."numberValue" IS NULL AND (c_filter."textValue" IS NULL OR c_filter."textValue" = '')))`;
      break;
    case FilterOperator.IS_NOT_EMPTY:
      filterWhereFragment = Prisma.sql`AND c_filter.id IS NOT NULL AND (c_filter."numberValue" IS NOT NULL OR (c_filter."textValue" IS NOT NULL AND c_filter."textValue" != ''))`;
      break;
    case FilterOperator.EQUALS:
      if (value != null) {
        if (filterColumn.type === ColumnType.NUMBER && valueNum != null)
          filterWhereFragment = Prisma.sql`AND c_filter."numberValue" = ${valueNum}`;
        else if (valueStr != null)
          filterWhereFragment = Prisma.sql`AND c_filter."textValue" = ${valueStr}`;
      }
      break;
    case FilterOperator.GREATER_THAN:
      if (valueNum != null) filterWhereFragment = Prisma.sql`AND c_filter."numberValue" > ${valueNum}`;
      break;
    case FilterOperator.LESS_THAN:
      if (valueNum != null) filterWhereFragment = Prisma.sql`AND c_filter."numberValue" < ${valueNum}`;
      break;
    case FilterOperator.CONTAINS:
      if (valueStr?.trim()) filterWhereFragment = Prisma.sql`AND c_filter."textValue" ILIKE ${"%" + valueStr.trim() + "%"}`;
      break;
    case FilterOperator.NOT_CONTAINS:
      if (valueStr?.trim())
        filterWhereFragment = Prisma.sql`AND (c_filter.id IS NULL OR c_filter."textValue" IS NULL OR c_filter."textValue" NOT ILIKE ${"%" + valueStr.trim() + "%"})`;
      break;
    default:
      break;
  }
  return { filterJoinFragment, filterWhereFragment };
}

async function buildSqlFilterFragmentsForFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tableId: string,
  filters: FilterItem[],
  filterLogicalOperator: "AND" | "OR",
): Promise<{ filterJoinFragment: Prisma.Sql; filterWhereFragment: Prisma.Sql }> {
  let filterJoinFragment = Prisma.empty;
  let filterWhereFragment = Prisma.empty;
  if (!filters.length) return { filterJoinFragment, filterWhereFragment };
  const joins: Prisma.Sql[] = [];
  const conditions: Prisma.Sql[] = [];
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i]!;
    const alias = `c_filter_${i}`;
    const valueStr = f.value == null ? null : typeof f.value === "string" ? f.value : String(f.value);
    const valueNum = f.value == null ? null : typeof f.value === "number" ? f.value : Number.isFinite(Number(f.value)) ? Number(f.value) : null;
    const col = await db.column.findUnique({ where: { id: f.columnId }, select: { tableId: true, type: true } });
    if (!col || col.tableId !== tableId) continue;
    joins.push(Prisma.sql`LEFT JOIN "Cell" ${Prisma.raw(alias)} ON ${Prisma.raw(alias)}."rowId" = r.id AND ${Prisma.raw(alias)}."columnId" = ${f.columnId}`);
    let cond: Prisma.Sql = Prisma.empty;
    switch (f.operator) {
      case FilterOperator.IS_EMPTY:
        cond = Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR (${Prisma.raw(alias)}."numberValue" IS NULL AND (${Prisma.raw(alias)}."textValue" IS NULL OR ${Prisma.raw(alias)}."textValue" = '')))`;
        break;
      case FilterOperator.IS_NOT_EMPTY:
        cond = Prisma.sql`${Prisma.raw(alias)}.id IS NOT NULL AND (${Prisma.raw(alias)}."numberValue" IS NOT NULL OR (${Prisma.raw(alias)}."textValue" IS NOT NULL AND ${Prisma.raw(alias)}."textValue" != ''))`;
        break;
      case FilterOperator.EQUALS:
        if (f.value != null) {
          if (col.type === ColumnType.NUMBER && valueNum != null) cond = Prisma.sql`${Prisma.raw(alias)}."numberValue" = ${valueNum}`;
          else if (valueStr != null) cond = Prisma.sql`${Prisma.raw(alias)}."textValue" = ${valueStr}`;
        }
        break;
      case FilterOperator.GREATER_THAN:
        if (valueNum != null) cond = Prisma.sql`${Prisma.raw(alias)}."numberValue" > ${valueNum}`;
        break;
      case FilterOperator.LESS_THAN:
        if (valueNum != null) cond = Prisma.sql`${Prisma.raw(alias)}."numberValue" < ${valueNum}`;
        break;
      case FilterOperator.CONTAINS:
        if (valueStr?.trim()) cond = Prisma.sql`${Prisma.raw(alias)}."textValue" ILIKE ${"%" + valueStr.trim() + "%"}`;
        break;
      case FilterOperator.NOT_CONTAINS:
        if (valueStr?.trim()) cond = Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR ${Prisma.raw(alias)}."textValue" IS NULL OR ${Prisma.raw(alias)}."textValue" NOT ILIKE ${"%" + valueStr.trim() + "%"})`;
        break;
      default:
        break;
    }
    if (cond !== Prisma.empty) conditions.push(cond);
  }
  if (joins.length === 0 || conditions.length === 0) return { filterJoinFragment, filterWhereFragment };
  filterJoinFragment = Prisma.join(joins, " ");
  const sep = filterLogicalOperator === "OR" ? " OR " : " AND ";
  filterWhereFragment = Prisma.sql`AND (${Prisma.join(conditions, sep)})`;
  return { filterJoinFragment, filterWhereFragment };
}

function normalizeFilters(
  filter: z.infer<typeof filterInput>,
  filters: FilterItem[] | undefined,
  filterLogicalOperator?: "AND" | "OR",
): { filters: FilterItem[]; filterLogicalOperator: "AND" | "OR" } {
  if (filters && filters.length > 0) return { filters, filterLogicalOperator: filterLogicalOperator ?? "AND" };
  if (filter) return { filters: [{ columnId: filter.columnId, operator: filter.operator, value: filter.value }], filterLogicalOperator: filterLogicalOperator ?? "AND" };
  return { filters: [], filterLogicalOperator: "AND" };
}

type SortItem = { direction: "asc" | "desc"; columnId: string };

function normalizeSorts(
  sort: z.infer<typeof sortInput>,
  sorts: z.infer<typeof sortsInput>,
): SortItem[] {
  if (sorts && sorts.length > 0) return sorts;
  if (sort?.columnId) return [{ direction: sort.direction ?? "asc", columnId: sort.columnId }];
  return [];
}

/** Build JOIN and ORDER BY fragments for multiple sort columns. */
async function buildMultiSortFragments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tableId: string,
  sorts: SortItem[],
): Promise<{ sortJoinFragment: Prisma.Sql; orderByFragment: Prisma.Sql } | null> {
  if (sorts.length === 0) return null;
  const columns = await db.column.findMany({
    where: { id: { in: sorts.map((s) => s.columnId) }, tableId },
    select: { id: true, type: true },
  });
  const colMap = new Map(columns.map((c) => [c.id, c]));
  const validSorts = sorts.filter((s) => colMap.has(s.columnId));
  if (validSorts.length === 0) return null;
  const joins: Prisma.Sql[] = [];
  const orderParts: Prisma.Sql[] = [];
  for (let i = 0; i < validSorts.length; i++) {
    const s = validSorts[i]!;
    const alias = `c_sort_${i}`;
    joins.push(
      Prisma.sql`LEFT JOIN "Cell" ${Prisma.raw(alias)} ON ${Prisma.raw(alias)}."rowId" = r.id AND ${Prisma.raw(alias)}."columnId" = ${s.columnId}`,
    );
    const col = colMap.get(s.columnId);
    const isNumber = col?.type === ColumnType.NUMBER;
    const isDesc = s.direction === "desc";
    const valCol = isNumber ? Prisma.sql`${Prisma.raw(alias)}."numberValue"` : Prisma.sql`${Prisma.raw(alias)}."textValue"`;
    if (isNumber) {
      orderParts.push(
        isDesc
          ? Prisma.sql`${valCol} DESC NULLS FIRST`
          : Prisma.sql`${valCol} ASC NULLS LAST`,
      );
    } else {
      orderParts.push(
        isDesc
          ? Prisma.sql`${valCol} DESC NULLS FIRST`
          : Prisma.sql`${valCol} ASC NULLS LAST`,
      );
    }
  }
  orderParts.push(Prisma.sql`r.id ASC`);
  const sortJoinFragment = Prisma.join(joins, " ");
  const orderByFragment = Prisma.sql`ORDER BY ${Prisma.join(orderParts, ", ")}`;
  return { sortJoinFragment, orderByFragment };
}

export const rowRouter = router({
  count: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        searchQuery: z.string().optional(),
        filter: filterInput,
        filters: filtersInput,
        filterLogicalOperator: filterLogicalOperatorSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const { filters, filterLogicalOperator } = normalizeFilters(input.filter, input.filters, input.filterLogicalOperator);
      const where = buildPrismaWhere(input.tableId, input.searchQuery, undefined, filters.length ? filters : undefined, filterLogicalOperator);
      const count = await ctx.db.row.count({ where });
      return { count };
    }),

  listPage: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(500),
        searchQuery: z.string().optional(),
        sort: sortInput,
        sorts: sortsInput,
        filter: filterInput,
        filters: filtersInput,
        filterLogicalOperator: filterLogicalOperatorSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const { filters, filterLogicalOperator } = normalizeFilters(input.filter, input.filters, input.filterLogicalOperator);
      const where = buildPrismaWhere(input.tableId, input.searchQuery, undefined, filters.length ? filters : undefined, filterLogicalOperator);
      const sorts = normalizeSorts(input.sort, input.sorts);

      if (sorts.length > 0) {
        const multi = await buildMultiSortFragments(ctx.db, input.tableId, sorts);
        if (multi) {
          const searchFragment = input.searchQuery?.trim()
            ? Prisma.sql`AND r."searchText" ILIKE ${"%" + input.searchQuery.trim() + "%"}`
            : Prisma.empty;
          const { filterJoinFragment, filterWhereFragment } = filters.length > 0
            ? await buildSqlFilterFragmentsForFilters(ctx.db, input.tableId, filters, filterLogicalOperator)
            : await buildSqlFilterFragments(ctx.db, input.tableId, undefined);

          const orderedIds = await ctx.db.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT r.id FROM "Row" r ${multi.sortJoinFragment} ${filterJoinFragment} WHERE r."tableId" = ${input.tableId} ${searchFragment} ${filterWhereFragment} ${multi.orderByFragment} OFFSET ${input.offset} LIMIT ${input.limit}`
          );
          const ids = orderedIds.map((x) => x.id);
          if (ids.length === 0) return { rows: [] };
          const rowsUnsorted = await ctx.db.row.findMany({
            where: { id: { in: ids } },
            include: { cells: true },
          });
          const byId = new Map(rowsUnsorted.map((r) => [r.id, r]));
          return { rows: ids.map((id) => byId.get(id)!).filter(Boolean) };
        }
      }

      const rows = await ctx.db.row.findMany({
        where,
        skip: input.offset,
        take: input.limit,
        orderBy: { index: input.sort?.direction ?? "asc" },
        include: { cells: true },
      });
      return { rows };
    }),

  listByTableId: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: cursorSchema,
        searchQuery: z.string().optional(),
        sort: z
          .object({
            direction: z.enum(["asc", "desc"]).default("asc"),
            /** When set, sort by this column's value (text or number) instead of row index. */
            columnId: z.string().optional(),
          })
          .optional(),
        sorts: sortsInput,
        filter: z
          .object({
            columnId: z.string(),
            operator: filterOperatorSchema,
            value: z.union([z.string(), z.number()]).nullable().optional(),
          })
          .optional(),
        filters: filtersInput,
        filterLogicalOperator: filterLogicalOperatorSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const { filters, filterLogicalOperator } = normalizeFilters(input.filter, input.filters, input.filterLogicalOperator);
      const sorts = normalizeSorts(input.sort, input.sorts);
      const where: Prisma.RowWhereInput = { tableId: input.tableId };
      if (input.searchQuery?.trim()) {
        where.searchText = {
          contains: input.searchQuery.trim(),
          mode: "insensitive",
        };
      }

      if (filters.length > 0) {
        const conditions = filters.map((f) => buildOneFilterCondition(f)).filter((c): c is Prisma.RowWhereInput => c != null);
        if (conditions.length > 0) {
          const op = filterLogicalOperator === "OR" ? "OR" : "AND";
          where[op] = conditions;
        }
      } else if (input.filter) {
        const { columnId, operator, value } = input.filter;

        const valueString =
          value == null ? null : typeof value === "string" ? value : String(value);
        const valueNumber =
          value == null
            ? null
            : typeof value === "number"
              ? value
              : Number.isFinite(Number(value))
                ? Number(value)
                : null;

        switch (operator) {
          case FilterOperator.IS_EMPTY: {
            where.OR = [
              { cells: { none: { columnId } } },
              {
                cells: {
                  some: {
                    columnId,
                    AND: [
                      { numberValue: null },
                      {
                        OR: [{ textValue: null }, { textValue: "" }],
                      },
                    ],
                  },
                },
              },
            ];
            break;
          }
          case FilterOperator.IS_NOT_EMPTY: {
            where.cells = {
              some: {
                columnId,
                OR: [
                  { numberValue: { not: null } },
                  {
                    AND: [
                      { textValue: { not: null } },
                      { NOT: { textValue: "" } },
                    ],
                  },
                ],
              },
            };
            break;
          }
          case FilterOperator.CONTAINS: {
            if (!valueString?.trim()) break;
            where.cells = {
              some: {
                columnId,
                textValue: { contains: valueString.trim(), mode: "insensitive" },
              },
            };
            break;
          }
          case FilterOperator.NOT_CONTAINS: {
            if (!valueString?.trim()) break;
            where.cells = {
              none: {
                columnId,
                textValue: { contains: valueString.trim(), mode: "insensitive" },
              },
            };
            break;
          }
          case FilterOperator.EQUALS: {
            if (value == null) break;
            const or: any[] = [];
            if (valueString != null) or.push({ textValue: valueString });
            if (valueNumber != null) or.push({ numberValue: valueNumber });
            if (or.length === 0) break;
            where.cells = {
              some: {
                columnId,
                OR: or,
              },
            };
            break;
          }
          case FilterOperator.GREATER_THAN: {
            if (valueNumber == null) break;
            where.cells = {
              some: {
                columnId,
                numberValue: { gt: valueNumber },
              },
            };
            break;
          }
          case FilterOperator.LESS_THAN: {
            if (valueNumber == null) break;
            where.cells = {
              some: {
                columnId,
                numberValue: { lt: valueNumber },
              },
            };
            break;
          }
          default: {
            break;
          }
        }
      }

      const isFirstPage = !input.cursor?.id && !input.cursor?.offset;
      const totalCount = isFirstPage
        ? await ctx.db.row.count({ where })
        : undefined;

      if (sorts.length > 1) {
        const multi = await buildMultiSortFragments(ctx.db, input.tableId, sorts);
        if (multi) {
          const limit = input.limit + 1;
          const offset = input.cursor?.offset ?? 0;
          const searchFragment = input.searchQuery?.trim()
            ? Prisma.sql`AND r."searchText" ILIKE ${"%" + input.searchQuery.trim() + "%"}`
            : Prisma.empty;
          let filterJoinFragment = Prisma.empty;
          let filterWhereFragment = Prisma.empty;
          if (filters.length > 0) {
            const built = await buildSqlFilterFragmentsForFilters(ctx.db, input.tableId, filters, filterLogicalOperator);
            filterJoinFragment = built.filterJoinFragment;
            filterWhereFragment = built.filterWhereFragment;
          } else if (input.filter) {
            const { filterJoinFragment: j, filterWhereFragment: w } = await buildSqlFilterFragments(ctx.db, input.tableId, input.filter);
            filterJoinFragment = j;
            filterWhereFragment = w;
          }
          const orderedIds = await ctx.db.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT r.id FROM "Row" r ${multi.sortJoinFragment} ${filterJoinFragment} WHERE r."tableId" = ${input.tableId} ${searchFragment} ${filterWhereFragment} ${multi.orderByFragment} OFFSET ${offset} LIMIT ${limit}`
          );
          const idList = orderedIds.map((x) => x.id);
          const hasMore = idList.length > input.limit;
          const ids = hasMore ? idList.slice(0, input.limit) : idList;
          if (ids.length === 0) return { rows: [], nextCursor: undefined, totalCount };
          const rowsUnsorted = await ctx.db.row.findMany({
            where: { id: { in: ids } },
            include: { cells: true },
          });
          const byId = new Map(rowsUnsorted.map((r) => [r.id, r]));
          const rows = ids.map((id) => byId.get(id)!).filter(Boolean);
          const nextCursor = hasMore ? { offset: offset + input.limit } : undefined;
          return { rows, nextCursor, totalCount };
        }
      }

      const sortByColumn = sorts.length === 1;

      if (sortByColumn) {
        const sort1 = sorts[0]!;
        const column = await ctx.db.column.findUnique({
          where: { id: sort1.columnId },
          select: { id: true, tableId: true, type: true },
        });
        if (!column || column.tableId !== input.tableId) {
          return { rows: [], nextCursor: undefined, totalCount: 0 };
        }
        const limit = input.limit + 1;
        const offset = input.cursor?.offset ?? 0;
        const searchFragment = input.searchQuery?.trim()
          ? Prisma.sql`AND r."searchText" ILIKE ${"%" + input.searchQuery.trim() + "%"}`
          : Prisma.empty;

        let filterJoinFragment = Prisma.empty;
        let filterWhereFragment = Prisma.empty;
        if (filters.length > 0) {
          const built = await buildSqlFilterFragmentsForFilters(ctx.db, input.tableId, filters, filterLogicalOperator);
          filterJoinFragment = built.filterJoinFragment;
          filterWhereFragment = built.filterWhereFragment;
        } else if (input.filter) {
          const { filterJoinFragment: j, filterWhereFragment: w } = await buildSqlFilterFragments(ctx.db, input.tableId, input.filter);
          filterJoinFragment = j;
          filterWhereFragment = w;
        }

        const isNumber = column.type === ColumnType.NUMBER;
        const isDesc = sort1.direction === "desc";
        const sortCol = isNumber
          ? Prisma.sql`c."numberValue"`
          : Prisma.sql`c."textValue"`;

        const orderByFragment = isNumber
          ? isDesc
            ? Prisma.sql`ORDER BY c."numberValue" DESC NULLS FIRST, r.id DESC`
            : Prisma.sql`ORDER BY c."numberValue" ASC NULLS LAST, r.id ASC`
          : isDesc
            ? Prisma.sql`ORDER BY c."textValue" DESC NULLS FIRST, r.id DESC`
            : Prisma.sql`ORDER BY c."textValue" ASC NULLS LAST, r.id ASC`;

        let keysetFragment = Prisma.empty;
        if (input.cursor?.sortId) {
          const lastId = input.cursor.sortId;
          const lastRaw = input.cursor.sortValue;
          const hasVal = lastRaw != null;
          const lastVal = isNumber
            ? (hasVal ? Number(lastRaw) : null)
            : (hasVal ? String(lastRaw) : null);

          if (!isDesc) {
            // ASC NULLS LAST: non-null ascending, then nulls by id asc
            if (hasVal) {
              keysetFragment = Prisma.sql`AND (
                ${sortCol} > ${lastVal} OR
                (${sortCol} = ${lastVal} AND r.id > ${lastId}) OR
                ${sortCol} IS NULL
              )`;
            } else {
              keysetFragment = Prisma.sql`AND (${sortCol} IS NULL AND r.id > ${lastId})`;
            }
          } else {
            // DESC NULLS FIRST: nulls by id desc, then non-null descending
            if (hasVal) {
              keysetFragment = Prisma.sql`AND (
                ${sortCol} < ${lastVal} OR
                (${sortCol} = ${lastVal} AND r.id < ${lastId})
              )`;
            } else {
              keysetFragment = Prisma.sql`AND (
                (${sortCol} IS NULL AND r.id < ${lastId}) OR
                ${sortCol} IS NOT NULL
              )`;
            }
          }
        }

        const orderedIds = await ctx.db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT r.id FROM "Row" r LEFT JOIN "Cell" c ON c."rowId" = r.id AND c."columnId" = ${sort1.columnId} ${filterJoinFragment} WHERE r."tableId" = ${input.tableId} ${searchFragment} ${filterWhereFragment} ${keysetFragment} ${orderByFragment} LIMIT ${limit}`
        );
        const idList = orderedIds.map((x) => x.id);
        const hasMore = idList.length > input.limit;
        const ids = hasMore ? idList.slice(0, input.limit) : idList;
        if (ids.length === 0) {
          return { rows: [], nextCursor: undefined, totalCount };
        }
        const rowsUnsorted = await ctx.db.row.findMany({
          where: { id: { in: ids } },
          include: {
            cells: true,
          },
        });
        const byId = new Map(rowsUnsorted.map((r) => [r.id, r]));
        const rows = ids.map((id) => byId.get(id)!).filter(Boolean);
        let nextCursor: typeof input.cursor = undefined;
        if (hasMore) {
          const lastRow = rows[rows.length - 1]!;
          const lastCell = lastRow.cells.find(
            (cl) => cl.columnId === sort1.columnId
          );
          const sv = isNumber
            ? (lastCell?.numberValue ?? null)
            : (lastCell?.textValue ?? null);
          nextCursor = { sortValue: sv, sortId: lastRow.id };
        }
        return { rows, nextCursor, totalCount };
      }

      const rows = await ctx.db.row.findMany({
        where,
        take: input.limit + 1,
        ...(input.cursor?.id
          ? { cursor: { id: input.cursor.id }, skip: 1 }
          : {}),
        orderBy: { index: input.sort?.direction ?? "asc" },
        include: {
          cells: true,
        },
      });
      let nextCursor: typeof input.cursor = undefined;
      if (rows.length > input.limit) {
        const last = rows[input.limit - 1];
        if (last) nextCursor = { id: last.id, index: last.index };
      }
      return {
        rows: rows.slice(0, input.limit),
        nextCursor,
        totalCount,
      };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.row.findUnique({
        where: { id: input.id },
        include: { cells: true },
      });
      if (!row) throw notFound("Row not found");
      return row;
    }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        createdById: z.string().optional(),
      }),
    )
    .output(rowOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const max = await ctx.db.row.aggregate({
          where: { tableId: input.tableId },
          _max: { index: true },
        });
        const index = (max._max.index ?? -1) + 1;
        return await ctx.db.row.create({
          data: {
            tableId: input.tableId,
            index,
            searchText: "",
            createdById: input.createdById ?? null,
          },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  addBatch: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        count: z.number().int().min(1).max(MAX_BATCH),
        createdById: z.string().optional(),
      })
    )
    .output(z.object({ count: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const createdById = input.createdById ?? ctx.userId ?? null;
      const table = await ctx.db.table.findUnique({
        where: { id: input.tableId },
        include: { columns: { orderBy: { position: "asc" } } },
      });
      if (!table) throw notFound("Table not found");
      const columns = table.columns;
      if (columns.length === 0) return { count: 0 };

      const max = await ctx.db.row.aggregate({
        where: { tableId: input.tableId },
        _max: { index: true },
      });
      const startIndex = (max._max.index ?? -1) + 1;

      // Bulk insert rows (no transaction wrapper — each statement auto-commits
      // which dramatically reduces WAL pressure and lock time)
      await ctx.db.$executeRawUnsafe(
        `INSERT INTO "Row" (id, "tableId", index, "searchText", "createdById", "createdAt", "updatedAt")
         SELECT gen_random_uuid()::text, $1::text, $2::int + gs - 1, '', $3::text, NOW(), NOW()
         FROM generate_series(1, $4::int) gs`,
        input.tableId,
        startIndex,
        createdById,
        input.count,
      );

      // Bulk insert cells for each column using pre-generated faker pools (pure SQL, no data transfer)
      for (const col of columns) {
        if (col.type === ColumnType.NUMBER) {
          const [min, max] = NUMBER_RANGES[col.name] ?? DEFAULT_NUMBER_RANGE;
          const range = max - min + 1;
          await ctx.db.$executeRawUnsafe(
            `INSERT INTO "Cell" (id, "rowId", "columnId", "textValue", "numberValue", "createdAt", "updatedAt")
             SELECT gen_random_uuid()::text, r.id, $1::text, NULL,
               floor(random() * $2::float8 + $3::float8),
               NOW(), NOW()
             FROM "Row" r
             WHERE r."tableId" = $4::text AND r.index >= $5::int`,
            col.id,
            range,
            min,
            input.tableId,
            startIndex,
          );
        } else {
          const pool = FAKER_POOLS[col.name] ?? DEFAULT_FAKER_POOL;
          const literal = sqlArrayLiteral(pool);
          await ctx.db.$executeRawUnsafe(
            `INSERT INTO "Cell" (id, "rowId", "columnId", "textValue", "numberValue", "createdAt", "updatedAt")
             SELECT gen_random_uuid()::text, r.id, $1::text,
               (${literal})[1 + floor(random() * ${pool.length})::int],
               NULL, NOW(), NOW()
             FROM "Row" r
             WHERE r."tableId" = $2::text AND r.index >= $3::int`,
            col.id,
            input.tableId,
            startIndex,
          );
        }
      }

      // searchText backfill is skipped for bulk inserts — it's the slowest
      // step and only needed for search. It gets populated lazily when cells
      // are individually edited via updateCell.

      return { count: input.count };
    }),

  updateCell: protectedProcedure
    .input(
      z.object({
        rowId: z.string(),
        columnId: z.string(),
        textValue: z.string().nullable().optional(),
        numberValue: z.number().nullable().optional(),
      }),
    )
    .output(rowOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.textValue !== undefined && input.numberValue !== undefined) {
          throw badRequest("Provide either textValue or numberValue, not both");
        }

        const [row, column] = await Promise.all([
          ctx.db.row.findUnique({
            where: { id: input.rowId },
            select: { id: true, tableId: true },
          }),
          ctx.db.column.findUnique({
            where: { id: input.columnId },
            select: { id: true, tableId: true, type: true },
          }),
        ]);

        if (!row) throw notFound("Row not found");
        if (!column) throw notFound("Column not found");
        if (column.tableId !== row.tableId) {
          throw badRequest("Column does not belong to the row's table");
        }

        if (column.type === ColumnType.TEXT && input.numberValue !== undefined) {
          throw badRequest("numberValue is invalid for TEXT columns");
        }
        if (column.type === ColumnType.NUMBER && input.textValue !== undefined) {
          throw badRequest("textValue is invalid for NUMBER columns");
        }

        await ctx.db.cell.upsert({
          where: {
            rowId_columnId: { rowId: input.rowId, columnId: input.columnId },
          },
          create: {
            rowId: input.rowId,
            columnId: input.columnId,
            textValue: input.textValue ?? null,
            numberValue: input.numberValue ?? null,
          },
          update: {
            textValue: input.textValue ?? undefined,
            numberValue: input.numberValue ?? undefined,
          },
        });

        const cells = await ctx.db.cell.findMany({
          where: { rowId: input.rowId },
          select: { textValue: true },
        });
        const searchText = cells
          .filter((c) => c.textValue != null && c.textValue !== "")
          .map((c) => c.textValue)
          .join(" ")
          .trim();

        return await ctx.db.row.update({
          where: { id: input.rowId },
          data: { searchText: searchText || "" },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(rowOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.row.delete({ where: { id: input.id } });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .output(bulkDeleteResultSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.db.row.deleteMany({
          where: { id: { in: input.ids } },
        });
        return { count: result.count };
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
