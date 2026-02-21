import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { CurrentActivityProvider } from "../features/activity/CurrentActivityContext";
import { ProfileProvider } from "../features/profiles/ProfileContext";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1
          }
        }
      })
  );

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ProfileProvider>
          <CurrentActivityProvider>{children}</CurrentActivityProvider>
        </ProfileProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
