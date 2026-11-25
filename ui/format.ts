// Display formatting shared by the palette's views.

/** `text` pretty-printed when it's JSON, else as is. */
export function prettyJson(text: string) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

/** A URL's path and query; only its path when `pathOnly` ("Hide query and hash"). */
export function shortUrl(url: string, pathOnly = false) {
    const u = new URL(url);
    return pathOnly ? u.pathname : u.pathname + u.search;
}

/** A gap between request starts, in at most two units. */
export function formatRequestGap(ms: number) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
    const days = Math.floor(hours / 24);
    return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}
