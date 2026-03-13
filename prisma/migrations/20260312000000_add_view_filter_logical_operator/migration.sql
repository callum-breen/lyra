-- AlterTable: single AND/OR for all filter conditions in a view
ALTER TABLE "View" ADD COLUMN IF NOT EXISTS "filterLogicalOperator" TEXT;
