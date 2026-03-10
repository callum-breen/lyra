import { faker } from "@faker-js/faker";
import { ColumnType } from "../../generated/prisma/client";

const DEFAULT_COLUMNS = ["Name", "Notes", "Status"] as const;
const DEFAULT_ROW_COUNT = 3;

function fakerValueForColumn(columnName: string): string {
  switch (columnName) {
    case "Name":
      return faker.person.fullName();
    case "Notes":
      return faker.lorem.sentence();
    case "Status":
      return faker.helpers.arrayElement([
        "Backlog",
        "In Progress",
        "Blocked",
        "Done",
      ]);
    default:
      return faker.lorem.words({ min: 1, max: 4 });
  }
}

type PrismaTx = {
  table: { create: (args: any) => Promise<any> };
  column: { create: (args: any) => Promise<any> };
  row: { create: (args: any) => Promise<any>; update: (args: any) => Promise<any> };
  cell: { createMany: (args: any) => Promise<any> };
  view: { create: (args: any) => Promise<any> };
  viewColumnVisibility: { create: (args: any) => Promise<any> };
};

export async function createTableWithDefaults(
  tx: PrismaTx,
  opts: {
    baseId: string;
    name: string;
    position?: number;
    createdById: string | null;
  },
) {
  const table = await tx.table.create({
    data: {
      baseId: opts.baseId,
      name: opts.name,
      position: opts.position ?? 0,
      createdById: opts.createdById,
    },
  });

  const columns: { id: string; name: string }[] = [];
  for (const [index, name] of DEFAULT_COLUMNS.entries()) {
    const col = await tx.column.create({
      data: {
        tableId: table.id,
        name,
        type: ColumnType.TEXT,
        position: index,
        createdById: opts.createdById,
      },
    });
    columns.push({ id: col.id, name: col.name });
  }

  for (let index = 0; index < DEFAULT_ROW_COUNT; index++) {
    const row = await tx.row.create({
      data: { tableId: table.id, index, createdById: opts.createdById },
    });
    const parts: string[] = [];
    const cellsData: { rowId: string; columnId: string; textValue: string }[] = [];
    for (const column of columns) {
      const value = fakerValueForColumn(column.name);
      parts.push(value);
      cellsData.push({ rowId: row.id, columnId: column.id, textValue: value });
    }
    await tx.row.update({
      where: { id: row.id },
      data: { searchText: parts.join(" ") },
    });
    await tx.cell.createMany({ data: cellsData });
  }

  const defaultView = await tx.view.create({
    data: { tableId: table.id, name: "Grid view", createdById: opts.createdById },
  });
  for (const [index, column] of columns.entries()) {
    await tx.viewColumnVisibility.create({
      data: {
        viewId: defaultView.id,
        columnId: column.id,
        visible: true,
        position: index,
        createdById: opts.createdById,
      },
    });
  }

  return table;
}
