/**
 * Spot-check relational integrity and sample queries after seeding.
 * Run: npm run db:validate
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("--- Counts (relational integrity) ---\n");

  const [userCount, baseCount, tableCount, columnCount, rowCount, cellCount, viewCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.base.count(),
      prisma.table.count(),
      prisma.column.count(),
      prisma.row.count(),
      prisma.cell.count(),
      prisma.view.count(),
    ]);

  console.log("User(s):     ", userCount);
  console.log("Base(s):     ", baseCount);
  console.log("Table(s):    ", tableCount);
  console.log("Column(s):   ", columnCount);
  console.log("Row(s):      ", rowCount);
  console.log("Cell(s):     ", cellCount);
  console.log("View(s):     ", viewCount);

  const tables = await prisma.table.findMany({ include: { _count: { select: { rows: true, columns: true } } } });
  const expectedCells = tables.reduce((sum, t) => sum + t._count.rows * t._count.columns, 0);
  const cellOk = cellCount === expectedCells ? "✓" : `✗ (expected ${expectedCells})`;
  console.log("\nCells = Σ(rows × columns) per table?", cellOk);

  console.log("\n--- Sample: User → Bases → Tables ---\n");

  const userWithBases = await prisma.user.findFirst({
    include: {
      bases: {
        include: {
          tables: { take: 2 },
        },
      },
    },
  });

  if (userWithBases) {
    console.log("User:", userWithBases.email ?? userWithBases.name);
    for (const base of userWithBases.bases) {
      console.log("  Base:", base.name, "→ tables:", base.tables.map((t) => t.name).join(", "));
    }
  }

  console.log("\n--- Sample: Table → Columns + first 2 Rows → Cells ---\n");

  const tableWithData = await prisma.table.findFirst({
    include: {
      base: { select: { name: true } },
      columns: { orderBy: { position: "asc" } },
      rows: { take: 2, orderBy: { index: "asc" }, include: { cells: { include: { column: true } } } },
    },
  });

  if (tableWithData) {
    console.log("Table:", tableWithData.name, "(base:", tableWithData.base.name + ")");
    console.log("Columns:", tableWithData.columns.map((c) => c.name).join(", "));
    for (const row of tableWithData.rows) {
      const cellValues = row.cells
        .sort((a, b) => (a.column.position > b.column.position ? 1 : -1))
        .map((cell) => cell.textValue ?? cell.numberValue ?? "—");
      console.log("  Row", row.index, ":", cellValues.join(" | "));
    }
  }

  console.log("\n--- Sample: View → filters, sort, column visibility ---\n");

  const viewWithConfig = await prisma.view.findFirst({
    include: {
      table: { select: { name: true } },
      filters: { include: { column: { select: { name: true } } } },
      sorts: { include: { column: { select: { name: true } } } },
      columnVisibility: { include: { column: { select: { name: true } } } },
    },
  });

  if (viewWithConfig) {
    console.log("View:", viewWithConfig.name, "(table:", viewWithConfig.table.name + ")");
    console.log("  Filters:", viewWithConfig.filters.map((f) => `${f.column.name} ${f.operator}`).join(", ") || "none");
    console.log("  Sorts:  ", viewWithConfig.sorts.map((s) => `${s.column.name} ${s.direction}`).join(", ") || "none");
    console.log("  Visible columns:", viewWithConfig.columnVisibility.filter((v) => v.visible).map((v) => v.column.name).join(", "));
  }

  console.log("\n--- Done ---\n");
}

main()
  .then(async () => await prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
