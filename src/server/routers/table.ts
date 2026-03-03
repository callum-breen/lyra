import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

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
    .query(({ ctx, input }) => {
      return ctx.db.table.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          columns: { orderBy: { position: "asc" } },
          views: { orderBy: { position: "asc" } },
          base: true,
        },
      });
    }),

  create: publicProcedure
    .input(
      z.object({
        baseId: z.string(),
        name: z.string().min(1),
        position: z.number().int().min(0).optional(),
        createdById: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db.table.create({
        data: {
          baseId: input.baseId,
          name: input.name,
          position: input.position ?? 0,
          createdById: input.createdById ?? null,
        },
      });
    }),
});
