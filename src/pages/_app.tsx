import { type AppType } from "next/dist/shared/lib/utils";
import { Geist } from "next/font/google";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { trpc, createTRPCClientForApp } from "~/utils/trpc";

import "~/styles/globals.css";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTRPCClientForApp());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <div className={geist.className}>
          <Component {...pageProps} />
        </div>
      </QueryClientProvider>
    </trpc.Provider>
  );
};

export default MyApp;
