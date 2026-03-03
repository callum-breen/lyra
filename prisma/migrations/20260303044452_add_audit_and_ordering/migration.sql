-- DropIndex
DROP INDEX "Base_ownerId_idx";

-- AlterTable
ALTER TABLE "Base" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Column" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Row" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ViewColumnVisibility" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "ViewFilter" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ViewSort" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Base_ownerId_position_idx" ON "Base"("ownerId", "position");

-- CreateIndex
CREATE INDEX "Base_createdById_idx" ON "Base"("createdById");

-- CreateIndex
CREATE INDEX "Column_createdById_idx" ON "Column"("createdById");

-- CreateIndex
CREATE INDEX "Row_createdById_idx" ON "Row"("createdById");

-- CreateIndex
CREATE INDEX "Table_createdById_idx" ON "Table"("createdById");

-- CreateIndex
CREATE INDEX "View_tableId_position_idx" ON "View"("tableId", "position");

-- CreateIndex
CREATE INDEX "View_createdById_idx" ON "View"("createdById");

-- CreateIndex
CREATE INDEX "ViewColumnVisibility_createdById_idx" ON "ViewColumnVisibility"("createdById");

-- CreateIndex
CREATE INDEX "ViewFilter_viewId_position_idx" ON "ViewFilter"("viewId", "position");

-- CreateIndex
CREATE INDEX "ViewFilter_createdById_idx" ON "ViewFilter"("createdById");

-- CreateIndex
CREATE INDEX "ViewSort_viewId_priority_idx" ON "ViewSort"("viewId", "priority");

-- CreateIndex
CREATE INDEX "ViewSort_createdById_idx" ON "ViewSort"("createdById");

-- AddForeignKey
ALTER TABLE "Base" ADD CONSTRAINT "Base_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Column" ADD CONSTRAINT "Column_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Row" ADD CONSTRAINT "Row_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewFilter" ADD CONSTRAINT "ViewFilter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewSort" ADD CONSTRAINT "ViewSort_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewColumnVisibility" ADD CONSTRAINT "ViewColumnVisibility_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
