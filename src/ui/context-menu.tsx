import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void | Promise<void>;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  label: string;
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({
  label,
  items,
  position,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const estimatedHeight = items.length * 32 + 12;
  const left = Math.max(8, Math.min(position.x, window.innerWidth - 208));
  const top = Math.max(
    8,
    Math.min(position.y, window.innerHeight - estimatedHeight),
  );

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleWindowChange = () => onClose();

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowChange);
    window.addEventListener("resize", handleWindowChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowChange);
      window.removeEventListener("resize", handleWindowChange);
    };
  }, [onClose]);

  return (
    <div
      aria-label={label}
      className="context-menu"
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          className={`${item.danger ? "is-danger " : ""}${
            item.separatorBefore ? "has-separator" : ""
          }`}
          key={item.label}
          onClick={() => {
            onClose();
            void item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
