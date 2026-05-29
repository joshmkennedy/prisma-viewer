import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createQueryClient } from "./app/query-client";
import { routeTree } from "./app/routes";
import { SidebarLayoutProvider } from "./app/sidebar-layout-store";

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createRouter({ routeTree }));

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarLayoutProvider>
        <RouterProvider router={router} />
      </SidebarLayoutProvider>
    </QueryClientProvider>
  );
}
