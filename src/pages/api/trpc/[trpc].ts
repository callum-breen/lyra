import { createNextApiHandler } from "@trpc/server/adapters/next";
import { appRouter } from "~/server/routers/index.js";
import { createContext } from "~/server/trpc.js";

export default createNextApiHandler({
  router: appRouter,
  createContext,
});
