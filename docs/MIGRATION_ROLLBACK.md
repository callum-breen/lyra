# Rolling back a Prisma migration

If your database stopped working after running a migration, you can try the following.

## 1. Check migration status

See which migrations are applied and whether anything failed:

```bash
npx prisma migrate status
```

## 2. Option A: Roll back only the last migration (keep data)

If the **last** migration you ran was `20260312000000_add_view_filter_logical_operator` (adds `filterLogicalOperator` to `View`):

**Step 1 – Mark that migration as rolled back** (so Prisma no longer considers it applied):

```bash
npx prisma migrate resolve --rolled-back 20260312000000_add_view_filter_logical_operator
```

**Step 2 – Undo the database change** by running the reverse SQL against your Postgres DB.

Using `psql` (replace with your connection string or env):

```bash
# If DATABASE_URL is in .env:
psql "$DATABASE_URL" -c 'ALTER TABLE "View" DROP COLUMN IF EXISTS "filterLogicalOperator";'
```

Or in Prisma Studio / any SQL client, run:

```sql
ALTER TABLE "View" DROP COLUMN IF EXISTS "filterLogicalOperator";
```

After that, run:

```bash
npx prisma generate
```

and restart your app. Your app code already handles a missing `filterLogicalOperator` column (it retries without it), so if the problem was this migration, rolling it back like this should fix it.

---

If a **different** migration is the one you want to undo, you’d need to:

1. Run `npx prisma migrate resolve --rolled-back <migration_name>` for that migration.
2. Manually run the reverse SQL for that migration (e.g. drop a column or table it added).

## 3. Option B: Reset the database (deletes all data)

Use this only in development when you’re OK losing all data. This will:

- Drop the database
- Recreate it
- Re-apply **all** migrations from scratch
- Run the seed script

```bash
npx prisma migrate reset
```

You will be prompted to confirm. After this, run `npx prisma generate` if needed and restart the app.

## 4. If migrations are in a failed state

If `prisma migrate status` shows a failed migration:

1. Fix the database manually (e.g. complete or revert the failing migration’s SQL).
2. Then run:

   ```bash
   npx prisma migrate resolve --rolled-back <failed_migration_name>
   ```

   or, if you fixed it so the migration is now applied:

   ```bash
   npx prisma migrate resolve --applied <migration_name>
   ```

## 5. Regenerate the Prisma client

After any schema or migration change:

```bash
npx prisma generate
```

Then restart your dev server.
