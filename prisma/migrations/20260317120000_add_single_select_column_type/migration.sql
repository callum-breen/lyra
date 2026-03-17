-- Add SINGLE_SELECT to ColumnType enum
ALTER TYPE "ColumnType" ADD VALUE 'SINGLE_SELECT';

-- Add options JSON column for single select options (label + color)
ALTER TABLE "Column" ADD COLUMN IF NOT EXISTS "options" JSONB;
