import { z } from "zod";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { tableOutputSchema } from "../schemas";
import { notFound, toTRPCError } from "../errors";

export const tableRouter = router({
  listByBaseId: publicProcedure
    .input(z.object({ baseId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.table.findMany({
        where: { baseId: input.baseId },
        orderBy: { position: "asc" },
        include: {
          columns: { orderBy: { position: "asc" } },
          views: { orderBy: { position: "asc" } },
        },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const table = await ctx.db.table.findUnique({
        where: { id: input.id },
        include: {
          columns: { orderBy: { position: "asc" } },
          views: { orderBy: { position: "asc" } },
          base: true,
        },
      });
      if (!table) throw notFound("Table not found");
      return table;
    }),

  create: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        name: z.string().min(1),
        position: z.number().int().min(0).optional(),
        createdById: z.string().optional(),
      }),
    )
    .output(tableOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.table.create({
          data: {
            baseId: input.baseId,
            name: input.name,
            position: input.position ?? 0,
            createdById: input.createdById ?? null,
          },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .output(tableOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...data } = input;
        return await ctx.db.table.update({ where: { id }, data });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(tableOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.table.delete({ where: { id: input.id } });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
