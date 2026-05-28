import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { ModelBrowserRoute, validateModelRouteSearch } from "../features/model-browser/ModelBrowserRoute";
import { QueryLabRoute } from "../features/query-lab/QueryLabRoute";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <ModelBrowserRoute routedModelName={null} />,
});

const modelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/model/$modelName",
  validateSearch: validateModelRouteSearch,
  component: ModelRoute,
});

const queryLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/query-lab",
  component: () => <QueryLabRoute initialModelName={null} />,
});

const queryLabModelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/query-lab/$modelName",
  component: QueryLabModelRoute,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  modelRoute,
  queryLabRoute,
  queryLabModelRoute,
]);

const registeredRouter = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof registeredRouter;
  }
}

function ModelRoute() {
  const { modelName } = modelRoute.useParams();
  const routeSearch = modelRoute.useSearch();
  return <ModelBrowserRoute routedModelName={modelName} rawRouteSearch={routeSearch} />;
}

function QueryLabModelRoute() {
  const { modelName } = queryLabModelRoute.useParams();
  return <QueryLabRoute initialModelName={modelName} />;
}
