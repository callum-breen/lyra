import { z } from "zod";
import { protectedProcedure, router, publicProcedure } from "../trpc.js";
import { baseOutputSchema } from "../schemas.js";
import { notFound, toTRPCError } from "../errors.js";

export const baseRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db.base.findMany({
      orderBy: { position: "asc" },
      include: { tables: { orderBy: { position: "asc" } } },
    });
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const base = await ctx.db.base.findUnique({
        where: { id: input.id },
        include: { tables: { orderBy: { position: "asc" } } },
      });
      if (!base) throw notFound("Base not found");
      return base;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        ownerId: z.string(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .output(baseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.base.create({
          data: {
            name: input.name,
            ownerId: input.ownerId,
            position: input.position ?? 0,
            createdById: input.ownerId,
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
    .output(baseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...data } = input;
        return await ctx.db.base.update({ where: { id }, data });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.base.delete({ where: { id: input.id } });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
