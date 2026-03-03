import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import {
  FilterOperator,
  SortDirection,
} from "../../../generated/prisma/client.js";
import {
  viewOutputSchema,
  viewWithRelationsOutputSchema,
} from "../schemas.js";

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
    .query(({ ctx, input }) => {
      return ctx.db.view.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          filters: { orderBy: { position: "asc" }, include: { column: true } },
          sorts: { orderBy: { priority: "asc" }, include: { column: true } },
          columnVisibility: { include: { column: true } },
          table: true,
        },
      });
    }),

  create: publicProcedure
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
    .mutation(({ ctx, input }) => {
      return ctx.db.view.create({
        data: {
          tableId: input.tableId,
          name: input.name,
          searchQuery: input.searchQuery ?? null,
          position: input.position ?? 0,
          createdById: input.createdById ?? null,
        },
      });
    }),

  update: publicProcedure
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
        await ctx.db.viewColumnVisibility.deleteMany({ where: { viewId: id } });
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
      return ctx.db.view.findUniqueOrThrow({
        where: { id },
        include: {
          filters: { orderBy: { position: "asc" }, include: { column: true } },
          sorts: { orderBy: { priority: "asc" }, include: { column: true } },
          columnVisibility: { include: { column: true } },
        },
      });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(viewOutputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.db.view.delete({
        where: { id: input.id },
      });
    }),
});
