import { useCallback, useEffect, useRef, useState } from 'react';

import type { OpenWorkspaceTarget } from '@/shared/graph-state';
import {
  chatPanelWidthStorageKey,
  clampChatPanelWidth,
  clampRailSidebarWidth,
  expandedGraphLayoutMinWidth,
  graphCollapsedStorageKey,
  initialChatPanelWidth,
  initialGraphCollapsed,
  initialOpenWorkspaceTarget,
  initialRailSidebarWidth,
  initialViewportWidth,
  openWorkspaceTargetStorageKey,
  railSidebarWidthStorageKey,
} from '@/lib/layout-prefs';
import { defaultThemeId, initialTheme, themeStorageKey, type ThemeId } from '@/lib/themes';

export type ColorScheme = 'dark' | 'light';

export const colorSchemeStorageKey = 'orrery.colorScheme.v1';

function initialColorScheme(): ColorScheme {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  // An explicit user choice wins; the OS preference is only the first-launch default.
  try {
    const stored = window.localStorage.getItem(colorSchemeStorageKey);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {
    // Fall through to the media query.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useLayoutPrefs() {
  const [chatPanelWidth, setChatPanelWidth] = useState(initialChatPanelWidth);
  const [sidebarWidth, setSidebarWidth] = useState(initialRailSidebarWidth);
  const [resizeTarget, setResizeTarget] = useState<{ panel: 'sidebar' | 'chat'; pointerId: number }>();
  const [graphCollapsed, setGraphCollapsed] = useState(initialGraphCollapsed);
  const [viewportWidth, setViewportWidth] = useState(initialViewportWidth);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(initialColorScheme);
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [openWorkspaceTarget, setOpenWorkspaceTarget] = useState<OpenWorkspaceTarget>(initialOpenWorkspaceTarget);
  const splitContainerRef = useRef<HTMLElement | null>(null);

  const adjustChatPanelWidth = useCallback((delta: number) => {
    const totalWidth = splitContainerRef.current?.getBoundingClientRect().width ?? (typeof window !== 'undefined' ? window.innerWidth : undefined);
    setChatPanelWidth((current) => clampChatPanelWidth(current + delta, totalWidth, sidebarWidth));
  }, [sidebarWidth]);

  const adjustSidebarWidth = useCallback((delta: number) => {
    setSidebarWidth((current) => clampRailSidebarWidth(current + delta));
  }, []);

  const changeSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(clampRailSidebarWidth(width));
  }, []);

  const startResizingSidebar = (pointerId: number) => setResizeTarget({ panel: 'sidebar', pointerId });
  const startResizingChatPanel = (pointerId: number) => setResizeTarget({ panel: 'chat', pointerId });
  const stopResizingPanels = () => setResizeTarget(undefined);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', colorScheme === 'dark');

    try {
      window.localStorage.setItem(colorSchemeStorageKey, colorScheme);
    } catch {
      // Scheme persistence is best-effort.
    }
  }, [colorScheme]);

  useEffect(() => {
    // The default theme uses the attribute-free Default token blocks.
    if (theme === defaultThemeId) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }

    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme persistence is best-effort.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(chatPanelWidthStorageKey, String(Math.round(chatPanelWidth)));
    } catch {
      // Width persistence is best-effort; resizing still works without storage.
    }
  }, [chatPanelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(railSidebarWidthStorageKey, String(Math.round(sidebarWidth)));
    } catch {
      // Width persistence is best-effort; resizing still works without storage.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(graphCollapsedStorageKey, graphCollapsed ? '1' : '0');
    } catch {
      // Collapse persistence is best-effort.
    }
  }, [graphCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(openWorkspaceTargetStorageKey, openWorkspaceTarget);
    } catch {
      // Open-target persistence is best-effort.
    }
  }, [openWorkspaceTarget]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      const totalWidth = splitContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setViewportWidth(totalWidth);
      setChatPanelWidth((current) => clampChatPanelWidth(current, totalWidth, sidebarWidth));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!resizeTarget) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== resizeTarget.pointerId) return;
      const rect = splitContainerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      if (resizeTarget.panel === 'sidebar') {
        setSidebarWidth(clampRailSidebarWidth(event.clientX - rect.left));
      } else {
        setChatPanelWidth(clampChatPanelWidth(event.clientX - rect.left - sidebarWidth, rect.width, sidebarWidth));
      }
    };

    const stopResizing = () => setResizeTarget(undefined);
    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId === resizeTarget.pointerId) stopResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', stopResizing, { once: true });

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', stopResizing);
    };
  }, [resizeTarget, sidebarWidth]);

  const graphForcedCollapsed = viewportWidth < expandedGraphLayoutMinWidth(sidebarWidth);
  const effectiveGraphCollapsed = graphCollapsed || graphForcedCollapsed;

  return {
    splitContainerRef,
    sidebarWidth,
    changeSidebarWidth,
    adjustSidebarWidth,
    isResizingSidebar: resizeTarget?.panel === 'sidebar',
    startResizingSidebar,
    stopResizingPanels,
    chatPanelWidth,
    isResizingChatPanel: resizeTarget?.panel === 'chat',
    startResizingChatPanel,
    graphCollapsed,
    setGraphCollapsed,
    viewportWidth,
    colorScheme,
    setColorScheme,
    theme,
    setTheme,
    openWorkspaceTarget,
    setOpenWorkspaceTarget,
    adjustChatPanelWidth,
    graphForcedCollapsed,
    effectiveGraphCollapsed,
  };
}

export type LayoutPrefsState = ReturnType<typeof useLayoutPrefs>;
