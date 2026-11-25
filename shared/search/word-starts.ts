// -------------------------------------------------------------------------------------------------
// WORD-START SEARCH
// Matching a query against the starts of a name's words, in order: "auEmI" finds
// autoEmbeddingInference (au·to Em·bedding I·nference). Words split at camelCase, digits
// boundaries kept, and any non-alphanumerics.
// -------------------------------------------------------------------------------------------------

/** `text`'s lowercase words: split at camelCase ("atlasGen2Clusters" → atlas, gen2, clusters) and non-alphanumerics. */
export function camelWords(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** The text's tokens (split at spaces and URL separators), each as its lowercase words (camelCase, - _ . split). */
export function tokenWords(text: string): string[][] {
    return text.split(/[\s/?&=#:,]+/).filter(Boolean).map(camelWords);
}

/** Whether `query` splits into pieces that each start one of `words`, in order (words may be skipped). */
export function matchesWordStarts(words: string[], query: string): boolean {
    const failed = new Set<number>();
    const from = (q: number, w: number): boolean => {
        if (q === query.length) return true;
        const key = q * (words.length + 1) + w;
        if (failed.has(key)) return false;
        for (let j = w; j < words.length; j++)
            for (let n = 1; n <= words[j].length && q + n <= query.length && words[j][n - 1] === query[q + n - 1]; n++)
                if (from(q + n, j + 1)) return true;
        failed.add(key);
        return false;
    };
    return from(0, 0);
}
