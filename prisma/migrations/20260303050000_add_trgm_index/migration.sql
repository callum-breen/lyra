-- Enable pg_trgm for fast ILIKE '%query%' searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on Row.searchText for sub-string search performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Row_searchText_trgm_idx"
  ON "Row" USING gin ("searchText" gin_trgm_ops);
