import { router, publicProcedure } from "../trpc.js";

/** Returns the first user's id for demo flows (e.g. create base) until auth is in place. */
export const userRouter = router({
  getDemoId: publicProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return user?.id ?? null;
  }),
});
