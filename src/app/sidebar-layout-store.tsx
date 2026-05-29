import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

type SidebarLayoutRoute = "models" | "queryLab";
type SidebarSide = "left" | "right";

type SidebarLayoutState = Record<SidebarLayoutRoute, Record<SidebarSide, boolean>>;

const defaultSidebarLayoutState: SidebarLayoutState = {
  models: { left: false, right: true },
  queryLab: { left: false, right: true },
};

type SidebarLayoutStore = {
  state: SidebarLayoutState;
  setCollapsed: (route: SidebarLayoutRoute, side: SidebarSide, isCollapsed: boolean) => void;
  toggle: (route: SidebarLayoutRoute, side: SidebarSide) => void;
};

const SidebarLayoutContext = createContext<SidebarLayoutStore | null>(null);

export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(defaultSidebarLayoutState);

  const store = useMemo<SidebarLayoutStore>(
    () => ({
      state,
      setCollapsed: (route, side, isCollapsed) => {
        setState((current) => ({
          ...current,
          [route]: {
            ...current[route],
            [side]: isCollapsed,
          },
        }));
      },
      toggle: (route, side) => {
        setState((current) => ({
          ...current,
          [route]: {
            ...current[route],
            [side]: !current[route][side],
          },
        }));
      },
    }),
    [state],
  );

  return (
    <SidebarLayoutContext.Provider value={store}>
      {children}
    </SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout(route: SidebarLayoutRoute) {
  const store = useContext(SidebarLayoutContext);
  if (!store) {
    throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
  }

  return {
    isLeftCollapsed: store.state[route].left,
    isRightCollapsed: store.state[route].right,
    collapseLeft: () => store.setCollapsed(route, "left", true),
    expandLeft: () => store.setCollapsed(route, "left", false),
    toggleLeft: () => store.toggle(route, "left"),
    collapseRight: () => store.setCollapsed(route, "right", true),
    expandRight: () => store.setCollapsed(route, "right", false),
    toggleRight: () => store.toggle(route, "right"),
  };
}
