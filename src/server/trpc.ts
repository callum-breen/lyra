import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { db } from "./db.js";

/**
 * Context passed to every tRPC procedure. Add session/user when auth is added.
 */
export function createContext() {
  return { db };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
