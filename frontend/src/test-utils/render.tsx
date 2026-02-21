import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { render } from "@testing-library/react";

function TestProviders({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      },
      mutations: {
        retry: false
      }
    }
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function renderWithQueryClient(ui: ReactElement) {
  return render(ui, { wrapper: TestProviders });
}
