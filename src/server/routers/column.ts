import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { ColumnType } from "../../../generated/prisma/client.js";
import { columnOutputSchema } from "../schemas.js";
import { notFound, toTRPCError } from "../errors.js";

const columnTypeSchema = z.nativeEnum(ColumnType);

export const columnRouter = router({
  listByTableId: publicProcedure
    .input(z.object({ tableId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.column.findMany({
        where: { tableId: input.tableId },
        orderBy: { position: "asc" },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const column = await ctx.db.column.findUnique({ where: { id: input.id } });
      if (!column) throw notFound("Column not found");
      return column;
    }),

  create: publicProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().min(1),
        type: columnTypeSchema,
        position: z.number().int().min(0).optional(),
        createdById: z.string().optional(),
      }),
    )
    .output(columnOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.column.create({
          data: {
            tableId: input.tableId,
            name: input.name,
            type: input.type,
            position: input.position ?? 0,
            createdById: input.createdById ?? null,
          },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        type: columnTypeSchema.optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .output(columnOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...data } = input;
        return await ctx.db.column.update({
          where: { id },
          data,
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(columnOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.column.delete({
          where: { id: input.id },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
