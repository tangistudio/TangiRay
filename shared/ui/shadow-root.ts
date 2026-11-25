// -------------------------------------------------------------------------------------------------
// SHADOW ROOT
// UI mounted by `tweak.onPage` lives in a closed shadow root: from the document, focus and selection
// inside it only show as its host. These read them from the root the node is in.
// -------------------------------------------------------------------------------------------------

/** The focused element in `node`'s document or shadow root. */
export function activeElementIn(node: Node) {
    return ((node.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement ?? null) as HTMLElement | null;
}

/** The selection in `node`'s document or shadow root (Chrome only exposes a shadow root's on the root). */
export function selectionIn(node: Node): Selection | null {
    const root = node.getRootNode() as { getSelection?: () => Selection | null };
    return root.getSelection?.() ?? window.getSelection();
}
