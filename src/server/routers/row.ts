import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

const cursorSchema = z
  .object({ id: z.string(), index: z.number() })
  .optional();

export const rowRouter = router({
  listByTableId: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: cursorSchema,
        searchQuery: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = { tableId: input.tableId } as { tableId: string; searchText?: { contains: string; mode: "insensitive" } };
      if (input.searchQuery?.trim()) {
        where.searchText = {
          contains: input.searchQuery.trim(),
          mode: "insensitive",
        };
      }
      const rows = await ctx.db.row.findMany({
        where,
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor.id }, skip: 1 }
          : {}),
        orderBy: { index: "asc" },
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
    .mutation(({ ctx, input }) => {
      return ctx.db.row.delete({ where: { id: input.id } });
    }),
});
