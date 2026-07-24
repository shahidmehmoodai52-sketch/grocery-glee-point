import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Refetch fresh data whenever the user returns to a tab/window or reconnects,
        // so stock/reports/intelligence never look stale after edits in another view.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 15_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
