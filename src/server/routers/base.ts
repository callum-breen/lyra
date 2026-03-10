import { z } from "zod";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { baseOutputSchema } from "../schemas";
import { notFound, toTRPCError } from "../errors";
import { createTableWithDefaults } from "../createTableWithDefaults";

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
        ownerId: z.string().optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .output(baseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const ownerId = input.ownerId ?? ctx.userId!;
        return await ctx.db.$transaction(async (tx) => {
          const base = await tx.base.create({
            data: {
              name: input.name,
              ownerId,
              position: input.position ?? 0,
              createdById: ownerId,
            },
          });

          await createTableWithDefaults(tx, {
            baseId: base.id,
            name: "Table 1",
            position: 0,
            createdById: ownerId,
          });

          return base;
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
        const base = await ctx.db.base.findUnique({ where: { id: input.id } });
        if (!base) throw notFound("Base not found");

        const id = input.id;
        const tableIdsSub = `(SELECT id FROM "Table" WHERE "baseId" = $1)`;
        const rowIdsSub = `(SELECT id FROM "Row" WHERE "tableId" IN ${tableIdsSub})`;
        const viewIdsSub = `(SELECT id FROM "View" WHERE "tableId" IN ${tableIdsSub})`;

        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "Cell" WHERE "rowId" IN ${rowIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "ViewColumnVisibility" WHERE "viewId" IN ${viewIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "ViewSort" WHERE "viewId" IN ${viewIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "ViewFilter" WHERE "viewId" IN ${viewIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "View" WHERE "tableId" IN ${tableIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "Row" WHERE "tableId" IN ${tableIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "Column" WHERE "tableId" IN ${tableIdsSub}`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "Table" WHERE "baseId" = $1`, id,
        );
        await ctx.db.$executeRawUnsafe(
          `DELETE FROM "Base" WHERE id = $1`, id,
        );

        return base;
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
