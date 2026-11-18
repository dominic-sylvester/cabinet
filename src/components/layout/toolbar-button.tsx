"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The single button used by every file-viewer toolbar. One tone so the whole
 * toolbar reads as one system: muted by default, foreground + accent on hover
 * (the same style the markdown formatting toolbar uses). Pass `iconOnly` for
 * bare-icon affordances (Open in new tab, zoom, globe…), `active` for toggles,
 * and `href` to render a link (download / open-raw).
 */
export interface ToolbarButtonProps {
  icon?: ComponentType<{ className?: string }>;
  /** Accessible name + default tooltip; also the visible text unless iconOnly. */
  label: string;
  /** Override the tooltip while keeping `label` as the accessible name. */
  title?: string;
  iconOnly?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** Render an <a> instead of a <button> (download links, open-raw). */
  href?: string;
  download?: boolean | string;
  target?: string;
  onClick?: () => void;
  className?: string;
  /** Rare: custom trailing content (e.g. a live percentage). */
  children?: ReactNode;
}

export function ToolbarButton({
  icon: Icon,
  label,
  title,
  iconOnly = false,
  active,
  disabled = false,
  href,
  download,
  target,
  onClick,
  className,
  children,
}: ToolbarButtonProps) {
  const cls = cn(
    "inline-flex h-[var(--control-height-compact)] shrink-0 items-center rounded-control text-meta font-medium transition-colors duration-[var(--motion-feedback)] cursor-pointer text-ink-secondary hover:bg-surface-hover hover:text-foreground active:bg-surface-pressed disabled:opacity-50 disabled:pointer-events-none",
    iconOnly ? "w-7 justify-center" : "gap-1.5 px-2",
    active && "bg-selection text-selection-foreground",
    className
  );
  const inner = (
    <>
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {!iconOnly && <span>{label}</span>}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        download={download}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
        className={cls}
        title={title ?? label}
        aria-label={label}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      data-slot="toolbar-button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cls}
      title={title ?? label}
      aria-label={label}
    >
      {inner}
    </button>
  );
}
