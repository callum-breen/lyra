import Head from "next/head";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

import styles from "./index.module.css";

export default function Home() {
  const { data: session, status } = useSession();

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
