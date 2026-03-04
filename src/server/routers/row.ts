import { z } from "zod";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { bulkDeleteResultSchema, rowOutputSchema } from "../schemas";
import type { Prisma } from "../../../generated/prisma/client";
import { ColumnType, FilterOperator } from "../../../generated/prisma/client";
import { badRequest, notFound, toTRPCError } from "../errors";

const cursorSchema = z
  .object({ id: z.string(), index: z.number() })
  .optional();

const filterOperatorSchema = z.nativeEnum(FilterOperator);

export const rowRouter = router({
  listByTableId: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: cursorSchema,
        searchQuery: z.string().optional(),
        sort: z
          .object({
            /** Currently only supports sorting by row index. */
            direction: z.enum(["asc", "desc"]).default("asc"),
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

      const rows = await ctx.db.row.findMany({
        where,
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor.id }, skip: 1 }
          : {}),
        orderBy: { index: input.sort?.direction ?? "asc" },
        include: {
          cells: {
            include: { column: true },
          },
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
      };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.row.findUnique({
        where: { id: input.id },
        include: { cells: { include: { column: true } } },
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
