import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { db } from "./db.js";

/**
 * Context passed to every tRPC procedure. Add session/user when auth is added.
 */
export function createContext() {
  return {
    db,
    /**
     * Placeholder for auth. Once NextAuth is wired up, populate this with the
     * currently authenticated user's id and other session data.
     */
    userId: null as string | null,
  };
}

export type Context = ReturnType<typeof createContext>;

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
