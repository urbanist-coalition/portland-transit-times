"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  CloseIcon,
  DarkModeIcon,
  HelpIcon,
  HomeIcon,
  LightModeIcon,
  MapIcon,
  MenuIcon,
} from "@/components/icons";
import { toggleColorMode } from "@/components/color-mode";

const LINKS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/by-location", label: "Map", Icon: MapIcon },
  { href: "/help", label: "Help", Icon: HelpIcon },
];

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Navigating away should always leave the menu closed
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className="nav" ref={rootRef} data-open={open}>
      <nav
        id="nav-menu-actions"
        className="nav-actions"
        aria-label="Site"
        // Keeping the actions mounted lets them animate, but they must not be
        //   reachable by keyboard or screen readers while collapsed.
        inert={!open}
      >
        {LINKS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="nav-action"
            aria-current={pathname === href ? "page" : undefined}
          >
            <span className="nav-action-label">{label}</span>
            <span className="nav-action-icon">
              <Icon size={20} />
            </span>
          </Link>
        ))}

        <button
          type="button"
          className="nav-action"
          onClick={() => {
            toggleColorMode();
            setOpen(false);
          }}
        >
          {/* Which of these shows is decided in CSS rather than JS so the
              correct one is painted on the very first frame. */}
          <span className="nav-action-label">
            <span className="when-light">Dark mode</span>
            <span className="when-dark">Light mode</span>
          </span>
          <span className="nav-action-icon">
            <span className="when-light">
              <DarkModeIcon size={20} />
            </span>
            <span className="when-dark">
              <LightModeIcon size={20} />
            </span>
          </span>
        </button>
      </nav>

      <button
        type="button"
        ref={toggleRef}
        className="nav-fab"
        aria-expanded={open}
        aria-controls="nav-menu-actions"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="nav-fab-icon">
          {open ? <CloseIcon size={26} /> : <MenuIcon size={26} />}
        </span>
      </button>
    </div>
  );
}
