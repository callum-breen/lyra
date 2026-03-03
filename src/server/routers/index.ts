import { baseRouter } from "./base.js";
import { columnRouter } from "./column.js";
import { rowRouter } from "./row.js";
import { tableRouter } from "./table.js";
import { viewRouter } from "./view.js";
import { router } from "../trpc.js";

export const appRouter = router({
  base: baseRouter,
  table: tableRouter,
  column: columnRouter,
  row: rowRouter,
  view: viewRouter,
});

export type AppRouter = typeof appRouter;
