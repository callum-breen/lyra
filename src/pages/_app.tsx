import { type AppType } from "next/dist/shared/lib/utils";
import { Geist } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "react-hot-toast";
import { trpc, createTRPCClientForApp } from "~/utils/trpc";
import { CreateBaseModalProvider } from "~/contexts/CreateBaseModalContext";
import { SearchProvider } from "~/contexts/SearchContext";

import "~/styles/globals.css";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTRPCClientForApp());

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <SearchProvider>
            <CreateBaseModalProvider>
              <div className={geist.className}>
                <Component {...pageProps} />
                <Toaster
                  position="bottom-right"
                  toastOptions={{
                    style: { fontSize: 13, borderRadius: 6, padding: "8px 14px" },
                    error: { duration: 4000 },
                    success: { duration: 2000 },
                  }}
                />
              </div>
            </CreateBaseModalProvider>
          </SearchProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
};

export default MyApp;
