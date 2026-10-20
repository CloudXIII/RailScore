/**
 * After the mobile keyboard opens, bring the focused field into the visible
 * area. A short wait lets the keyboard resize the viewport first.
 */
export function keepFieldInView(element: HTMLElement) {
  globalThis.setTimeout(() => {
    if (document.activeElement !== element) {
      return;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
  }, 280);
}
