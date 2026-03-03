import "dotenv/config";
import { faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  ColumnType,
  FilterOperator,
  SortDirection,
} from "../generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.viewColumnVisibility.deleteMany();
  await prisma.viewSort.deleteMany();
  await prisma.viewFilter.deleteMany();
  await prisma.view.deleteMany();
  await prisma.cell.deleteMany();
  await prisma.row.deleteMany();
  await prisma.column.deleteMany();
  await prisma.table.deleteMany();
  await prisma.base.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      name: "Demo User",
      email: "demo@example.com",
    },
  });

  async function createDemoTable(params: {
    baseId: string;
    name: string;
    position: number;
    textColumns: string[];
    numberColumns: string[];
    rows: number;
    createdById: string;
  }) {
    const { baseId, name, position, textColumns, numberColumns, rows, createdById } = params;

    const table = await prisma.table.create({
      data: { baseId, name, position, createdById },
    });

    const allColumns: { id: string; name: string; type: (typeof ColumnType)[keyof typeof ColumnType] }[] = [];

    for (const [index, colName] of textColumns.entries()) {
      const col = await prisma.column.create({
        data: {
          tableId: table.id,
          name: colName,
          type: ColumnType.TEXT,
          position: index,
          createdById,
        },
      });
      allColumns.push({ id: col.id, name: col.name, type: col.type });
    }

    for (const [offset, colName] of numberColumns.entries()) {
      const col = await prisma.column.create({
        data: {
          tableId: table.id,
          name: colName,
          type: ColumnType.NUMBER,
          position: textColumns.length + offset,
          createdById,
        },
      });
      allColumns.push({ id: col.id, name: col.name, type: col.type });
    }

    const batchSize = 100;
    let createdRows = 0;

    while (createdRows < rows) {
      const currentBatchSize = Math.min(batchSize, rows - createdRows);
      const rowIndices = Array.from(
        { length: currentBatchSize },
        (_, i) => createdRows + i
      );

      const created = await prisma.$transaction(
        async (tx) => {
          const rows: Awaited<ReturnType<typeof tx.row.create>>[] = [];
          for (const idx of rowIndices) {
            rows.push(
              await tx.row.create({
                data: { tableId: table.id, index: idx, createdById },
              })
            );
          }
          return rows;
        },
        { timeout: 30_000 }
      );

      const cellsData: {
        rowId: string;
        columnId: string;
        textValue?: string;
        numberValue?: number;
      }[] = [];

      for (const row of created) {
        const parts: string[] = [];

        for (const column of allColumns) {
          if (column.type === ColumnType.TEXT) {
            let value: string;
            switch (column.name) {
              case "Name":
                value = faker.person.fullName();
                break;
              case "Company":
                value = faker.company.name();
                break;
              case "Status":
                value = faker.helpers.arrayElement([
                  "Backlog",
                  "In Progress",
                  "Blocked",
                  "Done",
                ]);
                break;
              case "Owner":
                value = faker.person.fullName();
                break;
              case "Email":
                value = faker.internet.email().toLowerCase();
                break;
              default:
                value = faker.lorem.words({ min: 1, max: 4 });
            }
            parts.push(value);
            cellsData.push({ rowId: row.id, columnId: column.id, textValue: value });
          } else {
            let value: number;
            switch (column.name) {
              case "Priority":
                value = faker.number.int({ min: 1, max: 5 });
                break;
              case "Estimate (hrs)":
                value = faker.number.int({ min: 1, max: 40 });
                break;
              case "Budget":
                value = faker.number.int({ min: 1000, max: 100_000 });
                break;
              case "Score":
                value = faker.number.int({ min: 0, max: 100 });
                break;
              default:
                value = faker.number.int({ min: 0, max: 1000 });
            }
            parts.push(String(value));
            cellsData.push({
              rowId: row.id,
              columnId: column.id,
              numberValue: value,
            });
          }
        }

        await prisma.row.update({
          where: { id: row.id },
          data: { searchText: parts.join(" ") },
        });
      }

      await prisma.cell.createMany({ data: cellsData });
      createdRows += currentBatchSize;
    }

    const defaultView = await prisma.view.create({
      data: { tableId: table.id, name: "Grid view", createdById },
    });

    const firstColumnId = allColumns[0]?.id;
    if (firstColumnId) {
      await prisma.viewSort.create({
        data: {
          viewId: defaultView.id,
          columnId: firstColumnId,
          direction: SortDirection.ASC,
          priority: 0,
          createdById,
        },
      });
    }

    for (const [index, column] of allColumns.entries()) {
      await prisma.viewColumnVisibility.create({
        data: {
          viewId: defaultView.id,
          columnId: column.id,
          visible: true,
          position: index,
          createdById,
        },
      });
    }

    const statusColumn = allColumns.find((c) => c.name === "Status");
    if (statusColumn) {
      await prisma.viewFilter.create({
        data: {
          viewId: defaultView.id,
          columnId: statusColumn.id,
          operator: FilterOperator.IS_NOT_EMPTY,
          createdById,
        },
      });
    }
  }

  const productBase = await prisma.base.create({
    data: { name: "Product Planning", ownerId: user.id, createdById: user.id },
  });

  const salesBase = await prisma.base.create({
    data: { name: "Sales CRM", ownerId: user.id, createdById: user.id },
  });

  await createDemoTable({
    baseId: productBase.id,
    name: "Roadmap",
    position: 0,
    textColumns: ["Name", "Status", "Owner"],
    numberColumns: ["Priority", "Estimate (hrs)"],
    rows: 500,
    createdById: user.id,
  });

  await createDemoTable({
    baseId: salesBase.id,
    name: "Leads",
    position: 0,
    textColumns: ["Name", "Company", "Email"],
    numberColumns: ["Score", "Budget"],
    rows: 500,
    createdById: user.id,
  });

  console.log("Seed complete: Demo User, 2 bases (Product Planning, Sales CRM), 2 tables with 500 rows each.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
