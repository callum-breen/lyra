import { z } from "zod";
import { faker } from "@faker-js/faker";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { bulkDeleteResultSchema, rowOutputSchema } from "../schemas";
import { Prisma } from "../../../generated/prisma/client";
import { ColumnType, FilterOperator } from "../../../generated/prisma/client";
import { badRequest, notFound, toTRPCError } from "../errors";

const MAX_BATCH = 100_000;

function fakerTextValue(columnName: string): string {
  switch (columnName) {
    case "Name": return faker.person.fullName();
    case "Notes": return faker.lorem.sentence();
    case "Assignee":
    case "Owner": return faker.person.fullName();
    case "Status": return faker.helpers.arrayElement(["Backlog", "In Progress", "Blocked", "Done"]);
    case "Attachments": return faker.helpers.arrayElement(["—", "", faker.system.fileName()]);
    case "Company": return faker.company.name();
    case "Email": return faker.internet.email();
    default: return faker.lorem.words({ min: 1, max: 3 });
  }
}

function fakerNumberValue(columnName: string): number {
  switch (columnName) {
    case "Priority": return faker.number.int({ min: 1, max: 5 });
    case "Estimate (hrs)": return faker.number.int({ min: 1, max: 40 });
    case "Budget": return faker.number.int({ min: 1000, max: 100000 });
    case "Score": return faker.number.int({ min: 0, max: 100 });
    default: return faker.number.int({ min: 0, max: 1000 });
  }
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

const filterInput = z
  .object({
    columnId: z.string(),
    operator: filterOperatorSchema,
    value: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .optional();

const sortInput = z
  .object({
    direction: z.enum(["asc", "desc"]).default("asc"),
    columnId: z.string().optional(),
  })
  .optional();

function buildPrismaWhere(
  tableId: string,
  searchQuery?: string,
  filter?: z.infer<typeof filterInput>,
): Prisma.RowWhereInput {
  const where: Prisma.RowWhereInput = { tableId };
  if (searchQuery?.trim()) {
    where.searchText = { contains: searchQuery.trim(), mode: "insensitive" };
  }
  if (!filter) return where;

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

  switch (operator) {
    case FilterOperator.IS_EMPTY:
      where.OR = [
        { cells: { none: { columnId } } },
        { cells: { some: { columnId, AND: [{ numberValue: null }, { OR: [{ textValue: null }, { textValue: "" }] }] } } },
      ];
      break;
    case FilterOperator.IS_NOT_EMPTY:
      where.cells = { some: { columnId, OR: [{ numberValue: { not: null } }, { AND: [{ textValue: { not: null } }, { NOT: { textValue: "" } }] }] } };
      break;
    case FilterOperator.CONTAINS:
      if (valueString?.trim()) where.cells = { some: { columnId, textValue: { contains: valueString.trim(), mode: "insensitive" } } };
      break;
    case FilterOperator.NOT_CONTAINS:
      if (valueString?.trim()) where.cells = { none: { columnId, textValue: { contains: valueString.trim(), mode: "insensitive" } } };
      break;
    case FilterOperator.EQUALS: {
      if (value == null) break;
      const or: Prisma.CellWhereInput[] = [];
      if (valueString != null) or.push({ textValue: valueString });
      if (valueNumber != null) or.push({ numberValue: valueNumber });
      if (or.length) where.cells = { some: { columnId, OR: or } };
      break;
    }
    case FilterOperator.GREATER_THAN:
      if (valueNumber != null) where.cells = { some: { columnId, numberValue: { gt: valueNumber } } };
      break;
    case FilterOperator.LESS_THAN:
      if (valueNumber != null) where.cells = { some: { columnId, numberValue: { lt: valueNumber } } };
      break;
    default:
      break;
  }
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

export const rowRouter = router({
  count: publicProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      const count = await ctx.db.row.count({ where: { tableId: input.tableId } });
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
        filter: filterInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildPrismaWhere(input.tableId, input.searchQuery, input.filter);

      const sortByColumn = input.sort?.columnId != null && input.sort.columnId !== "";
      if (sortByColumn) {
        const column = await ctx.db.column.findUnique({
          where: { id: input.sort!.columnId },
          select: { id: true, tableId: true, type: true },
        });
        if (!column || column.tableId !== input.tableId) return { rows: [] };

        const searchFragment = input.searchQuery?.trim()
          ? Prisma.sql`AND r."searchText" ILIKE ${"%" + input.searchQuery.trim() + "%"}`
          : Prisma.empty;
        const { filterJoinFragment, filterWhereFragment } = await buildSqlFilterFragments(ctx.db, input.tableId, input.filter);

        const isNumber = column.type === ColumnType.NUMBER;
        const isDesc = input.sort!.direction === "desc";
        const orderByFragment = isNumber
          ? isDesc
            ? Prisma.sql`ORDER BY c."numberValue" DESC NULLS FIRST, r.id DESC`
            : Prisma.sql`ORDER BY c."numberValue" ASC NULLS LAST, r.id ASC`
          : isDesc
            ? Prisma.sql`ORDER BY c."textValue" DESC NULLS FIRST, r.id DESC`
            : Prisma.sql`ORDER BY c."textValue" ASC NULLS LAST, r.id ASC`;

        const orderedIds = await ctx.db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT r.id FROM "Row" r LEFT JOIN "Cell" c ON c."rowId" = r.id AND c."columnId" = ${input.sort!.columnId!} ${filterJoinFragment} WHERE r."tableId" = ${input.tableId} ${searchFragment} ${filterWhereFragment} ${orderByFragment} OFFSET ${input.offset} LIMIT ${input.limit}`
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
        filter: z
          .object({
            columnId: z.string(),
            operator: filterOperatorSchema,
            value: z.union([z.string(), z.number()]).nullable().optional(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.RowWhereInput = { tableId: input.tableId };
      if (input.searchQuery?.trim()) {
        where.searchText = {
          contains: input.searchQuery.trim(),
          mode: "insensitive",
        };
      }

      if (input.filter) {
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

      const sortByColumn =
        input.sort?.columnId != null && input.sort.columnId !== "";

      if (sortByColumn) {
        const column = await ctx.db.column.findUnique({
          where: { id: input.sort!.columnId },
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
        if (input.filter) {
          const { columnId: filterColumnId, operator, value } = input.filter;
          const valueStr =
            value == null ? null : typeof value === "string" ? value : String(value);
          const valueNum =
            value == null
              ? null
              : typeof value === "number"
                ? value
                : Number.isFinite(Number(value))
                  ? Number(value)
                  : null;
          const filterColumn = await ctx.db.column.findUnique({
            where: { id: filterColumnId },
            select: { tableId: true, type: true },
          });
          if (filterColumn && filterColumn.tableId === input.tableId) {
            filterJoinFragment = Prisma.sql`LEFT JOIN "Cell" c_filter ON c_filter."rowId" = r.id AND c_filter."columnId" = ${filterColumnId}`;
            const isNumber = filterColumn.type === ColumnType.NUMBER;
            switch (operator) {
              case FilterOperator.IS_EMPTY:
                filterWhereFragment = Prisma.sql`AND (c_filter.id IS NULL OR (c_filter."numberValue" IS NULL AND (c_filter."textValue" IS NULL OR c_filter."textValue" = '')))`;
                break;
              case FilterOperator.IS_NOT_EMPTY:
                filterWhereFragment = Prisma.sql`AND c_filter.id IS NOT NULL AND (c_filter."numberValue" IS NOT NULL OR (c_filter."textValue" IS NOT NULL AND c_filter."textValue" != ''))`;
                break;
              case FilterOperator.EQUALS:
                if (value != null) {
                  if (isNumber && valueNum != null)
                    filterWhereFragment = Prisma.sql`AND c_filter."numberValue" = ${valueNum}`;
                  else if (valueStr != null)
                    filterWhereFragment = Prisma.sql`AND c_filter."textValue" = ${valueStr}`;
                }
                break;
              case FilterOperator.GREATER_THAN:
                if (valueNum != null)
                  filterWhereFragment = Prisma.sql`AND c_filter."numberValue" > ${valueNum}`;
                break;
              case FilterOperator.LESS_THAN:
                if (valueNum != null)
                  filterWhereFragment = Prisma.sql`AND c_filter."numberValue" < ${valueNum}`;
                break;
              case FilterOperator.CONTAINS:
                if (valueStr?.trim())
                  filterWhereFragment = Prisma.sql`AND c_filter."textValue" ILIKE ${"%" + valueStr.trim() + "%"}`;
                break;
              case FilterOperator.NOT_CONTAINS:
                if (valueStr?.trim())
                  filterWhereFragment = Prisma.sql`AND (c_filter.id IS NULL OR c_filter."textValue" IS NULL OR c_filter."textValue" NOT ILIKE ${"%" + valueStr.trim() + "%"})`;
                break;
              default:
                break;
            }
          }
        }

        const isNumber = column.type === ColumnType.NUMBER;
        const isDesc = input.sort!.direction === "desc";
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
          Prisma.sql`SELECT r.id FROM "Row" r LEFT JOIN "Cell" c ON c."rowId" = r.id AND c."columnId" = ${input.sort!.columnId!} ${filterJoinFragment} WHERE r."tableId" = ${input.tableId} ${searchFragment} ${filterWhereFragment} ${keysetFragment} ${orderByFragment} LIMIT ${limit}`
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
            (cl) => cl.columnId === input.sort!.columnId
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

      // Fetch newly created row IDs in order
      const newRows = await ctx.db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "Row" WHERE "tableId" = ${input.tableId} AND index >= ${startIndex} ORDER BY index ASC`
      );
      const rowIds = newRows.map((r) => r.id);

      // Bulk insert cells for each column using faker-generated values
      for (const col of columns) {
        const isNumber = col.type === ColumnType.NUMBER;
        const textValues = isNumber ? rowIds.map(() => null) : rowIds.map(() => fakerTextValue(col.name));
        const numberValues = isNumber ? rowIds.map(() => fakerNumberValue(col.name)) : rowIds.map(() => null);

        await ctx.db.$executeRawUnsafe(
          `INSERT INTO "Cell" (id, "rowId", "columnId", "textValue", "numberValue", "createdAt", "updatedAt")
           SELECT gen_random_uuid()::text, unnest($1::text[]), $2::text, unnest($3::text[]), unnest($4::float8[]), NOW(), NOW()`,
          rowIds,
          col.id,
          textValues,
          numberValues,
        );
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
