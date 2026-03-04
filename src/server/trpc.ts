import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { db } from "./db.js";
import { getServerAuthSession } from "./auth.js";

/**
 * Context passed to every tRPC procedure. Includes db and session-derived userId.
 */
export async function createContext(opts: CreateNextContextOptions) {
  const session = await getServerAuthSession({ req: opts.req, res: opts.res });
  return {
    db,
    userId: session?.user?.id ?? null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});

export const protectedProcedure = t.procedure.use(isAuthed);
