import { useRouter } from "next/router";
import { useEffect, useRef } from "react";

import { trpc } from "~/utils/trpc";

export default function BasePage() {
  const router = useRouter();
  const baseId = router.query.baseId as string | undefined;
  const didRedirect = useRef(false);

  const { data: tables, status } = trpc.table.listByBaseId.useQuery(
    { baseId: baseId! },
    { enabled: !!baseId },
  );

  useEffect(() => {
    if (didRedirect.current || status !== "success" || !baseId || !tables) return;
    didRedirect.current = true;

    if (tables.length === 0) {
      void router.replace("/");
      return;
    }

    let targetId = tables[0]!.id;
    try {
      const saved = localStorage.getItem(`lyra:lastTable:${baseId}`);
      if (saved && tables.some((t) => t.id === saved)) {
        targetId = saved;
      }
    } catch {}

    void router.replace(`/bases/${baseId}/tables/${targetId}`);
  }, [baseId, tables, status, router]);

  return (
    <div style={{
      height: "100vh",
      background: "#f7f8fc",
    }} />
  );
}
