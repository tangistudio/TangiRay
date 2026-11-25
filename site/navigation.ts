import type { SiteEvents } from "./site-events";

/** Report page URL changes, including fragment-only navigation. */
export function patchNavigation(ctx: TangiTweak.SiteCtx, events: SiteEvents) {
    let lastUrl = location.href;
    ctx.once("api-interceptor-initial-url", () => {
        events.emit({ kind: "navigation", url: lastUrl, initial: true });
        return true;
    });
    const changed = () => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            events.emit({ kind: "navigation", url });
        }
    };
    for (const method of ["pushState", "replaceState"] as const) {
        ctx.patch(history, method, (orig) => function (this: History, ...args: Parameters<History[typeof method]>) {
            const result = orig.apply(this, args);
            changed();
            return result;
        });
    }
    window.addEventListener("popstate", changed, { signal: ctx.signal });
    window.addEventListener("hashchange", changed, { signal: ctx.signal });
    return changed;
}
