import { baseRouter } from "./base";
import { columnRouter } from "./column";
import { rowRouter } from "./row";
import { tableRouter } from "./table";
import { userRouter } from "./user";
import { viewRouter } from "./view";
import { router } from "../trpc";

export const appRouter = router({
  base: baseRouter,
  table: tableRouter,
  column: columnRouter,
  row: rowRouter,
  view: viewRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
