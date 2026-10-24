import type { MouseEvent } from "react";

// Keep static copy from becoming a text-caret target while retaining ordinary
// form focus, labels, links, menus and SVG plot interactions.
export function preventStaticTextCaret(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, button, a, select, label, summary, svg, [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [contenteditable="true"]')) return;
  event.preventDefault();
}
