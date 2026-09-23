"use client";

import { useEffect } from "react";

interface DraftNavigationGuardProps {
  dirty: boolean;
}

const warning = "You have unsaved trade changes. Leave this page and discard them?";

export function DraftNavigationGuard({ dirty }: DraftNavigationGuardProps) {
  useEffect(() => {
    if (!dirty) return;

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    function beforeLinkNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!window.confirm(warning)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLinkNavigation, true);
    };
  }, [dirty]);

  return null;
}
