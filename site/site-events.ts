import type { SiteEvent } from "../domain/types";

// -------------------------------------------------------------------------------------------------
// SITE EVENTS
// The fetch/XHR patch runs in the site's world, which can't write the page's log: it queues what
// happens here, and the page's `tweak.onPage` code pulls it through the handle (`ctx.each`).
// -------------------------------------------------------------------------------------------------

/** queued while nobody pulls (e.g. before the page's code runs); the oldest go first */
const MAX_QUEUED = 2000;
/** events per handle answer (a handle call carries at most 1 MB) */
const BATCH = 100;

export class SiteEvents {
    private queue: SiteEvent[] = [];
    private waiting: ((events: SiteEvent[]) => void)[] = [];

    emit(event: SiteEvent) {
        // answer every waiting call: one may be from a run that ended since
        if (this.waiting.length) { for (const w of this.waiting.splice(0)) w([event]); return; }
        this.queue.push(event);
        if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
    }

    /** The next events, as soon as there are any. */
    next(): Promise<SiteEvent[]> {
        return this.queue.length ? Promise.resolve(this.queue.splice(0, BATCH)) : new Promise((resolve) => this.waiting.push(resolve));
    }
}
