/** An ⌥ shortcut's key, faint, beside what it does. */
export const Kbd = ({ k }: { k: string }) => <kbd className="aip-kbd" aria-hidden>⌥{k}</kbd>;

/** A button's shortcut, beside its label. */
export const ButtonKey = ({ k }: { k: string }) => <kbd className="aip-btn-key" aria-hidden>{k}</kbd>;
