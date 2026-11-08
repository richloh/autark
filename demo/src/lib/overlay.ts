/**
 * Portal target for overlays (modals, menus, tooltips). It is a fixed, viewport-sized CSS container so
 * container-query classes used inside overlays resolve against the viewport, while page content resolves
 * against the main content area (which shrinks when the AI pane is open).
 */
let root: HTMLElement | null = null;
export function overlayRoot(): HTMLElement {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.id = 'overlay-root';
  document.body.appendChild(root);
  return root;
}
