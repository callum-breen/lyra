import { z } from "zod";
import { protectedProcedure, router, publicProcedure } from "../trpc";
import { FilterOperator, SortDirection } from "../../../generated/prisma/client";
import {
  viewOutputSchema,
  viewWithRelationsOutputSchema,
} from "../schemas";
import { notFound, toTRPCError } from "../errors";

const filterOperatorSchema = z.nativeEnum(FilterOperator);
const sortDirectionSchema = z.nativeEnum(SortDirection);

const viewFilterSchema = z.object({
  columnId: z.string(),
  operator: filterOperatorSchema,
  value: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const viewSortSchema = z.object({
  columnId: z.string(),
  direction: sortDirectionSchema,
  priority: z.number().int().min(0).optional(),
});

const viewColumnVisibilitySchema = z.object({
  columnId: z.string(),
  visible: z.boolean(),
  position: z.number().int().min(0).nullable().optional(),
});

export const viewRouter = router({
  listByTableId: publicProcedure
    .input(z.object({ tableId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.view.findMany({
        where: { tableId: input.tableId },
        orderBy: { position: "asc" },
        include: {
          filters: { orderBy: { position: "asc" }, include: { column: true } },
          sorts: { orderBy: { priority: "asc" }, include: { column: true } },
          columnVisibility: { include: { column: true } },
        },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const view = await ctx.db.view.findUnique({
        where: { id: input.id },
        include: {
          filters: { orderBy: { position: "asc" }, include: { column: true } },
          sorts: { orderBy: { priority: "asc" }, include: { column: true } },
          columnVisibility: { include: { column: true } },
          table: true,
        },
      });
      if (!view) throw notFound("View not found");
      return view;
    }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().min(1),
        searchQuery: z.string().nullable().optional(),
        position: z.number().int().min(0).optional(),
        createdById: z.string().optional(),
      }),
    )
    .output(viewOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.view.create({
          data: {
            tableId: input.tableId,
            name: input.name,
            searchQuery: input.searchQuery ?? null,
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
        searchQuery: z.string().nullable().optional(),
        position: z.number().int().min(0).optional(),
        filters: z.array(viewFilterSchema).optional(),
        sorts: z.array(viewSortSchema).optional(),
        columnVisibility: z.array(viewColumnVisibilitySchema).optional(),
        createdById: z.string().optional(),
      }),
    )
    .output(viewWithRelationsOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, filters, sorts, columnVisibility, ...data } = input;
        await ctx.db.view.update({
          where: { id },
          data,
        });
        if (filters !== undefined) {
          await ctx.db.viewFilter.deleteMany({ where: { viewId: id } });
          if (filters.length > 0) {
            await ctx.db.viewFilter.createMany({
              data: filters.map((f, i) => ({
                viewId: id,
                columnId: f.columnId,
                operator: f.operator,
                value: f.value ?? null,
                position: f.position ?? i,
                createdById: input.createdById ?? null,
              })),
            });
          }
        }
        if (sorts !== undefined) {
          await ctx.db.viewSort.deleteMany({ where: { viewId: id } });
          if (sorts.length > 0) {
            await ctx.db.viewSort.createMany({
              data: sorts.map((s, i) => ({
                viewId: id,
                columnId: s.columnId,
                direction: s.direction,
                priority: s.priority ?? i,
                createdById: input.createdById ?? null,
              })),
            });
          }
        }
        if (columnVisibility !== undefined) {
          await ctx.db.viewColumnVisibility.deleteMany({
            where: { viewId: id },
          });
          if (columnVisibility.length > 0) {
            await ctx.db.viewColumnVisibility.createMany({
              data: columnVisibility.map((v) => ({
                viewId: id,
                columnId: v.columnId,
                visible: v.visible,
                position: v.position ?? null,
                createdById: input.createdById ?? null,
              })),
            });
          }
        }
        return await ctx.db.view.findUniqueOrThrow({
          where: { id },
          include: {
            filters: { orderBy: { position: "asc" }, include: { column: true } },
            sorts: { orderBy: { priority: "asc" }, include: { column: true } },
            columnVisibility: { include: { column: true } },
          },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(viewOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.view.delete({
          where: { id: input.id },
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
