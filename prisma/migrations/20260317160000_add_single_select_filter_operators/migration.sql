-- Add filter operators for single select: NOT_EQUALS, IS_ANY_OF, IS_NONE_OF
ALTER TYPE "FilterOperator" ADD VALUE 'NOT_EQUALS';
ALTER TYPE "FilterOperator" ADD VALUE 'IS_ANY_OF';
ALTER TYPE "FilterOperator" ADD VALUE 'IS_NONE_OF';
