import Head from "next/head";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AppLayout } from "~/components/AppLayout";
import { useCreateBaseModal } from "~/contexts/CreateBaseModalContext";
import { useSearch } from "~/contexts/SearchContext";
import { trpc } from "~/utils/trpc";
import styles from "./index.module.css";

function AirtableLogo({ width = 42, height }: { width?: number; height?: number }) {
  const h = height ?? (width * 170) / 200;
  return (
    <svg
      width={width}
      height={h}
      viewBox="0 0 200 170"
      style={{ shapeRendering: "geometricPrecision" }}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g>
        <path fill="rgb(255, 186, 5)" d="M90.0389,12.3675 L24.0799,39.6605 C20.4119,41.1785 20.4499,46.3885 24.1409,47.8515 L90.3759,74.1175 C96.1959,76.4255 102.6769,76.4255 108.4959,74.1175 L174.7319,47.8515 C178.4219,46.3885 178.4609,41.1785 174.7919,39.6605 L108.8339,12.3675 C102.8159,9.8775 96.0559,9.8775 90.0389,12.3675" />
        <path fill="rgb(57, 202, 255)" d="M105.3122,88.4608 L105.3122,154.0768 C105.3122,157.1978 108.4592,159.3348 111.3602,158.1848 L185.1662,129.5368 C186.8512,128.8688 187.9562,127.2408 187.9562,125.4288 L187.9562,59.8128 C187.9562,56.6918 184.8092,54.5548 181.9082,55.7048 L108.1022,84.3528 C106.4182,85.0208 105.3122,86.6488 105.3122,88.4608" />
        <path fill="rgb(220, 4, 59)" d="M88.0781,91.8464 L66.1741,102.4224 L63.9501,103.4974 L17.7121,125.6524 C14.7811,127.0664 11.0401,124.9304 11.0401,121.6744 L11.0401,60.0884 C11.0401,58.9104 11.6441,57.8934 12.4541,57.1274 C12.7921,56.7884 13.1751,56.5094 13.5731,56.2884 C14.6781,55.6254 16.2541,55.4484 17.5941,55.9784 L87.7101,83.7594 C91.2741,85.1734 91.5541,90.1674 88.0781,91.8464" />
        <path fill="rgba(0, 0, 0, 0.25)" d="M88.0781,91.8464 L66.1741,102.4224 L12.4541,57.1274 C12.7921,56.7884 13.1751,56.5094 13.5731,56.2884 C14.6781,55.6254 16.2541,55.4484 17.5941,55.9784 L87.7101,83.7594 C91.2741,85.1734 91.5541,90.1674 88.0781,91.8464" />
      </g>
    </svg>
  );
}

const BASE_CARD_COLORS = [
  "#ef4444", "#f97316", "#d97706", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#2563eb", "#7c3aed", "#ec4899",
];

function getBaseColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BASE_CARD_COLORS[Math.abs(hash) % BASE_CARD_COLORS.length]!;
}

function getBaseInitials(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase().slice(0, 2);
  }
  return name.slice(0, 2).toUpperCase() || "Un";
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function BaseCardMenu({ baseId, baseName }: { baseId: string; baseName: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"actions" | "rename">("actions");
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const updateBase = trpc.base.update.useMutation({
    onSuccess: () => {
      setMode("actions");
      setOpen(false);
      void utils.base.list.invalidate();
    },
    onError: () => toast.error("Failed to rename base"),
  });

  const deleteBase = trpc.base.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.base.list.cancel();
      const previous = utils.base.list.getData();
      utils.base.list.setData(undefined, (old) =>
        old ? old.filter((b) => b.id !== id) : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) utils.base.list.setData(undefined, context.previous);
      toast.error("Failed to delete base");
    },
    onSettled: () => void utils.base.list.invalidate(),
  });

  useEffect(() => {
    if (open) setMode("actions");
  }, [open]);

  useEffect(() => {
    if (open && mode === "rename") {
      setRenameDraft(baseName);
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [open, mode, baseName]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={styles.baseCardMenuBtn}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Options for ${baseName}`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div ref={menuRef} className={styles.baseCardMenuDropdown}>
          {mode === "rename" ? (
            <div className={styles.baseCardRenamePanel}>
              <input
                ref={renameInputRef}
                type="text"
                className={styles.baseCardRenameInput}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const name = renameDraft.trim();
                    if (name && name !== baseName) {
                      updateBase.mutate({ id: baseId, name });
                    }
                  }
                }}
                placeholder="Base name"
                aria-label="Base name"
              />
              <div className={styles.baseCardRenameActions}>
                <button
                  type="button"
                  className={styles.baseCardRenameCancel}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMode("actions");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.baseCardRenameSave}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const name = renameDraft.trim();
                    if (name && name !== baseName) {
                      updateBase.mutate({ id: baseId, name });
                    }
                  }}
                  disabled={!renameDraft.trim() || renameDraft.trim() === baseName}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={styles.baseCardMenuItem}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMode("rename");
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className={styles.baseCardMenuDelete}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteBase.mutate({ id: baseId });
                  setOpen(false);
                }}
                disabled={deleteBase.isPending}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                </svg>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  const { query: searchQuery } = useSearch();
  const createModal = useCreateBaseModal();
  const utils = trpc.useUtils();
  const {
    data: bases,
    status: basesStatus,
    isError: basesError,
    refetch: refetchBases,
  } = trpc.base.list.useQuery(undefined, { enabled: !!session });

  const filteredBases =
    bases?.filter((base) =>
      base.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    ) ?? [];

  if (status === "loading") {
    return (
      <>
        <Head><title>Airtable</title></Head>
        <div className={styles.signInPage} />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <Head><title>Sign in – Airtable</title></Head>
        <div className={styles.signInPage}>
          <div className={styles.signInCard}>
            <div className={styles.logoWrap}>
              <AirtableLogo width={42} />
            </div>
            <h1 className={styles.signInHeading}>Sign in to Airtable</h1>
            <div className={styles.googleButtonWrap}>
              <button
                type="button"
                className={styles.googleButton}
                onClick={() => void signIn("google")}
              >
                <span className={styles.googleIconWrap}>
                  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
                    <path d="M17.64,9.20454545 C17.64,8.56636364 17.5827273,7.95272727 17.4763636,7.36363636 L9,7.36363636 L9,10.845 L13.8436364,10.845 C13.635,11.97 13.0009091,12.9231818 12.0477273,13.5613636 L12.0477273,15.8195455 L14.9563636,15.8195455 C16.6581818,14.2527273 17.64,11.9454545 17.64,9.20454545 L17.64,9.20454545 Z" fill="#4285F4" />
                    <path d="M9,18 C11.43,18 13.4672727,17.1940909 14.9563636,15.8195455 L12.0477273,13.5613636 C11.2418182,14.1013636 10.2109091,14.4204545 9,14.4204545 C6.65590909,14.4204545 4.67181818,12.8372727 3.96409091,10.71 L0.957272727,10.71 L0.957272727,13.0418182 C2.43818182,15.9831818 5.48181818,18 9,18 L9,18 Z" fill="#34A853" />
                    <path d="M3.96409091,10.71 C3.78409091,10.17 3.68181818,9.59318182 3.68181818,9 C3.68181818,8.40681818 3.78409091,7.83 3.96409091,7.29 L3.96409091,4.95818182 L0.957272727,4.95818182 C0.347727273,6.17318182 0,7.54772727 0,9 C0,10.4522727 0.347727273,11.8268182 0.957272727,13.0418182 L3.96409091,10.71 L3.96409091,10.71 Z" fill="#FBBC05" />
                    <path d="M9,3.57954545 C10.3213636,3.57954545 11.5077273,4.03363636 12.4404545,4.92545455 L15.0218182,2.34409091 C13.4631818,0.891818182 11.4259091,0 9,0 C5.48181818,0 2.43818182,2.01681818 0.957272727,4.95818182 L3.96409091,7.29 C4.67181818,5.16272727 6.65590909,3.57954545 9,3.57954545 L9,3.57954545 Z" fill="#EA4335" />
                  </svg>
                </span>
                <span className={styles.googleButtonText}>
                  Continue with <strong>Google</strong>
                </span>
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Airtable</title>
        <meta name="description" content="Airtable-style bases" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <AppLayout>
        <h1 className={styles.pageTitle}>Home</h1>

        {basesStatus === "pending" && (
          <div className={styles.baseCardRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard}>
                <div className={styles.skeletonCardIcon} />
                <div className={styles.skeletonCardContent}>
                  <div className={styles.skeletonCardLine} style={{ width: `${60 + (i * 13) % 30}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {basesError && (
          <div className={styles.errorBlock}>
            <p className={styles.mutedText}>Failed to load bases.</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void refetchBases()}
            >
              Retry
            </button>
          </div>
        )}
        {basesStatus === "success" && bases && !basesError && (
          <div className={styles.baseCardRow}>
            {filteredBases.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.mutedText}>
                  {bases.length === 0
                    ? "No bases yet."
                    : "No bases match your search."}
                </p>
                {bases.length === 0 && createModal && (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => createModal.openCreateModal()}
                    style={{ marginTop: "0.75rem" }}
                  >
                    Create base
                  </button>
                )}
              </div>
            ) : (
              filteredBases.map((base) => (
                <div key={base.id} className={styles.baseCardWrap}>
                  <Link
                    href={`/bases/${base.id}`}
                    className={styles.baseCard}
                    onMouseEnter={() => void utils.base.getById.prefetch({ id: base.id })}
                  >
                    <div
                      className={styles.baseCardIcon}
                      style={{ background: getBaseColor(base.name) }}
                    >
                      {getBaseInitials(base.name)}
                    </div>
                    <div className={styles.baseCardContent}>
                      <h2 className={styles.baseCardName}>{base.name}</h2>
                    </div>
                  </Link>
                  <BaseCardMenu baseId={base.id} baseName={base.name} />
                </div>
              ))
            )}
          </div>
        )}
      </AppLayout>
    </>
  );
}
