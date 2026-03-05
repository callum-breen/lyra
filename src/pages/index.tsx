import Head from "next/head";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

import { trpc } from "~/utils/trpc";
import styles from "./index.module.css";

export default function Home() {
  const { data: session, status } = useSession();
  const { data: bases, status: basesStatus } = trpc.base.list.useQuery(
    undefined,
    { enabled: !!session }
  );

  return (
    <>
      <Head>
        <title>Airtable</title>
        <meta name="description" content="Airtable-style bases" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.title}>Airtable</h1>
          <div className={styles.authContainer}>
            {status === "loading" ? (
              <span className={styles.showcaseText}>Loading…</span>
            ) : session ? (
              <>
                <span className={styles.showcaseText}>
                  Signed in as {session.user?.email ?? session.user?.name ?? "User"}
                </span>
                <button
                  type="button"
                  className={styles.loginButton}
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
                {basesStatus === "pending" && (
                  <span className={styles.showcaseText}>Loading bases…</span>
                )}
                {basesStatus === "success" && bases && (
                  <div className={styles.cardRow}>
                    {bases.length === 0 ? (
                      <p className={styles.showcaseText}>No bases yet.</p>
                    ) : (
                      bases.map((base) => (
                        <Link
                          key={base.id}
                          href={`/bases/${base.id}`}
                          className={styles.card}
                        >
                          <h2 className={styles.cardTitle}>{base.name}</h2>
                          <p className={styles.cardText}>
                            {base.tables.length} table
                            {base.tables.length !== 1 ? "s" : ""}
                          </p>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                className={styles.loginButton}
                onClick={() => void signIn("google")}
              >
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
