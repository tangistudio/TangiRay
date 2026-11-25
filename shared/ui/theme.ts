
// -------------------------------------------------------------------------------------------------
// THEME
// Colors as CSS variables, light or dark with the system (prefers-color-scheme). Put THEME_CSS
// before a UI's own CSS and use var(--wt-…) there (on `:root` in an overlay, `:host` in a page
// mount's shadow root). A UI's root sets `color-scheme: light dark`
// itself (WT_COLOR_SCHEME): set on an overlay's whole page, it would make the frame opaque.
// -------------------------------------------------------------------------------------------------

const LIGHT = {
    surface: "#fff",
    text: "#001e2b",
    "text-soft": "#3d4f58",
    "text-muted": "#5c6c75",
    "text-faint": "#889397",
    border: "#c1c7c6",
    "border-soft": "#e8edeb",
    fill: "#f0f3f2",
    "fill-soft": "#f9fbfa",
    "fill-strong": "#eef2f1",
    accent: "#016bf8",
    green: "#00684a",
    "green-bg": "#e3fcf7",
    "green-border": "#a6e5d6",
    "green-strong": "#00a35c",
    yellow: "#944f01",
    "yellow-bg": "#fef7db",
    "yellow-border": "#f5dc8a",
    "yellow-strong": "#ffc010",
    red: "#970606",
    "red-bg": "#ffeae5",
    "red-strong": "#db3030",
    blue: "#1254b7",
    "blue-bg": "#e1f7ff",
    "blue-border": "#a8dcf7",
    purple: "#5e0c9e",
    "purple-bg": "#f1e3fd",
    "purple-border": "#dcb8f7",
    "cap-border": "#d5dcdb",
    // custom capsule kinds: hsl(hue 70% bg-l) etc.
    "cap-bg-l": "93%",
    "cap-border-l": "80%",
    "cap-text-l": "28%",
    // code
    "code-active-line": "rgba(0, 30, 43, .035)",
    "code-selection": "#add6ff",
    "code-selection-blur": "#e5ebf1",
    "code-selection-match": "rgba(173, 214, 255, .45)",
    "code-bracket": "#c3e7fe",
    "code-bracket-border": "#94c8ef",
    "code-property": "#0451a5",
    "code-string": "#a31515",
    "code-number": "#098658",
    "code-keyword": "#0000ff",
    "code-comment": "#008000",
    "code-invalid": "#cd3131",
};

const DARK: typeof LIGHT = {
    surface: "#1c2d38",
    text: "#e8edeb",
    "text-soft": "#c1c7c6",
    "text-muted": "#a3b0b5",
    "text-faint": "#7c8a91",
    border: "#4a5c66",
    "border-soft": "#2c3e48",
    fill: "#253742",
    "fill-soft": "#16242e",
    "fill-strong": "#22343f",
    accent: "#4da3ff",
    green: "#71f6ba",
    "green-bg": "#0b3b2e",
    "green-border": "#1a5c48",
    "green-strong": "#00a35c",
    yellow: "#ffc010",
    "yellow-bg": "#3d2f05",
    "yellow-border": "#6b5000",
    "yellow-strong": "#ffc010",
    red: "#ff8f87",
    "red-bg": "#4a1a14",
    "red-strong": "#ef5752",
    blue: "#8ec5ff",
    "blue-bg": "#0c2f4a",
    "blue-border": "#1c4f73",
    purple: "#e3c9fb",
    "purple-bg": "#2e1546",
    "purple-border": "#5e3c86",
    "cap-border": "#3d4f58",
    "cap-bg-l": "20%",
    "cap-border-l": "35%",
    "cap-text-l": "82%",
    "code-active-line": "rgba(255, 255, 255, .04)",
    "code-selection": "#264f78",
    "code-selection-blur": "#2c3e48",
    "code-selection-match": "rgba(38, 79, 120, .6)",
    "code-bracket": "#1f4a6b",
    "code-bracket-border": "#3d78a8",
    "code-property": "#9cdcfe",
    "code-string": "#ce9178",
    "code-number": "#b5cea8",
    "code-keyword": "#569cd6",
    "code-comment": "#6a9955",
    "code-invalid": "#f44747",
};

const vars = (colors: typeof LIGHT) => Object.entries(colors).map(([name, value]) => `--wt-${name}: ${value};`).join(" ");

export const THEME_CSS = `
:root, :host { ${vars(LIGHT)} }
@media (prefers-color-scheme: dark) { :root, :host { ${vars(DARK)} } }
`;

/** For a UI's root rule: native controls (checkboxes, selects, scrollbars) follow the theme. */
export const WT_COLOR_SCHEME = "color-scheme: light dark;";
