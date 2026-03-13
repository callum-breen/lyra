import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import styles from "./ProfileDropdown.module.css";

type ProfileDropdownProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  position?: "bottom-right" | "side-right";
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute("disabled"));
}

export function ProfileDropdown({ anchorRef, onClose, position = "bottom-right" }: ProfileDropdownProps) {
  const { data: session } = useSession();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const rect = anchorRef.current.getBoundingClientRect();
    if (position === "side-right") {
      setCoords({
        top: Math.max(8, rect.bottom - 160),
        left: rect.right + 10,
      });
    } else {
      setCoords({
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - 280),
      });
    }
  }, [anchorRef, position]);

  useEffect(() => {
    if (!coords || !dropdownRef.current) return;
    const focusables = getFocusableElements(dropdownRef.current);
    if (focusables.length > 0) focusables[0]!.focus();
  }, [coords]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dropdownRef.current) return;
      const focusables = getFocusableElements(dropdownRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose, anchorRef]);

  const name = session?.user?.name ?? "User";
  const email = session?.user?.email ?? "";

  if (!coords) return null;

  return (
    <div
      ref={dropdownRef}
      className={styles.dropdown}
      style={{ top: coords.top, left: coords.left }}
      role="menu"
      aria-label="Profile menu"
    >
      <div className={styles.header}>
        <div className={styles.name}>{name}</div>
        <div className={styles.email}>{email}</div>
      </div>
      <div className={styles.divider} />
      <button
        type="button"
        className={styles.logoutBtn}
        role="menuitem"
        onClick={() => void signOut({ callbackUrl: "/" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Log out
      </button>
    </div>
  );
}
