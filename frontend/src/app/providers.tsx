import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { CurrentActivityProvider } from "../features/activity/CurrentActivityContext";
import { AuthProvider } from "../features/auth/AuthContext";
import { ProfileProvider } from "../features/profiles/ProfileContext";
import { ThemeProvider } from "./theme";

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
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ProfileProvider>
              <CurrentActivityProvider>{children}</CurrentActivityProvider>
            </ProfileProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
