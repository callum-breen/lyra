import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const baseRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db.base.findMany({
      orderBy: { position: "asc" },
      include: { tables: { orderBy: { position: "asc" } } },
    });
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.base.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          tables: { orderBy: { position: "asc" } },
        },
      });
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        ownerId: z.string(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db.base.create({
        data: {
          name: input.name,
          ownerId: input.ownerId,
          position: input.position ?? 0,
          createdById: input.ownerId,
        },
      });
    }),
});
