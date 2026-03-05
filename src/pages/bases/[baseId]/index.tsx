import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

import { trpc } from "~/utils/trpc";
import styles from "~/pages/index.module.css";

export default function BasePage() {
  const router = useRouter();
  const baseId = router.query.baseId as string | undefined;
  const { data: base, status } = trpc.base.getById.useQuery(
    { id: baseId! },
    { enabled: !!baseId }
  );
  const { data: tables = [], status: tablesStatus } =
    trpc.table.listByBaseId.useQuery(
      { baseId: baseId! },
      { enabled: !!baseId && status === "success" }
    );

  if (!baseId) return null;
  if (status === "pending") {
    return (
      <>
        <Head>
          <title>Base – Airtable</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.container}>
            <p className={styles.showcaseText}>Loading base…</p>
          </div>
        </main>
      </>
    );
  }
  if (status === "error" || !base) {
    return (
      <>
        <Head>
          <title>Base – Airtable</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.container}>
            <p className={styles.showcaseText}>Base not found.</p>
            <Link href="/" className={styles.loginButton}>
              Back home
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{base.name} – Airtable</title>
      </Head>
      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.authContainer}>
            <Link href="/" className={styles.showcaseText} style={{ marginBottom: "1rem" }}>
              ← Back to bases
            </Link>
            <h1 className={styles.title}>{base.name}</h1>
            {tablesStatus === "pending" ? (
              <p className={styles.showcaseText}>Loading tables…</p>
            ) : tables.length === 0 ? (
              <p className={styles.showcaseText}>No tables in this base.</p>
            ) : (
              <div className={styles.cardRow}>
                {tables.map((table) => (
                  <Link
                    key={table.id}
                    href={`/bases/${baseId}/tables/${table.id}`}
                    className={styles.card}
                  >
                    <h2 className={styles.cardTitle}>{table.name}</h2>
                    <p className={styles.cardText}>
                      {table.columns.length} column
                      {table.columns.length !== 1 ? "s" : ""}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
