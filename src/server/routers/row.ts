import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { rowOutputSchema } from "../schemas.js";
import { FilterOperator } from "../../../generated/prisma/client.js";

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
      const where: any = { tableId: input.tableId };
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
    .query(({ ctx, input }) => {
      return ctx.db.row.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          cells: { include: { column: true } },
        },
      });
    }),

  create: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        createdById: z.string().optional(),
      }),
    )
    .output(rowOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const max = await ctx.db.row.aggregate({
        where: { tableId: input.tableId },
        _max: { index: true },
      });
      const index = (max._max.index ?? -1) + 1;
      return ctx.db.row.create({
        data: {
          tableId: input.tableId,
          index,
          searchText: "",
          createdById: input.createdById ?? null,
        },
      });
    }),

  updateCell: publicProcedure
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
        include: { column: true },
      });
      const searchText = cells
        .filter((c) => c.textValue != null && c.textValue !== "")
        .map((c) => c.textValue)
        .join(" ")
        .trim();
      return ctx.db.row.update({
        where: { id: input.rowId },
        data: { searchText: searchText || "" },
      });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(rowOutputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.db.row.delete({ where: { id: input.id } });
    }),
});
