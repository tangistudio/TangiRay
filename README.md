# TangiRay

A [TangiTweak script](https://github.com/tangistudio/TangiTweak) to track and rewrite a tab's API calls, on any site. Press **⌘'** (Ctrl+' elsewhere) to open it. Site-specific knowledge comes from [plugins](#plugins); the [Atlas plugin](#atlas-plugin) is plugged in by default.

## What it does

Track every `fetch`/XHR call in the tab (kept across navigations and reloads) and inspect or modify requests and responses. Folds repetitive requests, tracks `#` navigations and clicks on interactive controls, and exports the listed requests (in chronological order) or a single one as HAR, and rules as JSON. Rules match on a [URL pattern](https://developer.mozilla.org/docs/Web/API/URL_Pattern_API) (e.g. `https://example.com/api/:team/items/*`, or `/api/*` on any origin), method, query params and request content. Rules can **pause** a request (to send it edited or not, respond to it on the spot, or block it) or its response (to edit it), **mock** a response without sending the request (status, content type, body, optional delay), or **delay** requests; list-only rules **hide**, **favourite** (pin to top) or **fold** requests. Tick **Remember** on a paused request or response to have the rule do the same automatically, without pausing (switch it back to **Each time** in the rule editor). Delays of all matching rules add up; the first rule that changes something decides.

TangiRay marks gaps of 5 seconds or more between consecutive recorded request starts and shows page URL changes, including fragments. When requests span pages, it also labels the initial page; page labels pin flush to the top across the full request-list width while scrolling. Time gaps are omitted where folded, filtered or pinned rows would make the timeline misleading.
Hovering or arrowing through requests shows each one in the details panel; **click a request to pin it** there while you move through the list (click it again, or press Esc, to unpin). Enter or a double-click makes a rule from the request.
Its **⋯** menu has **Settings** (hover it, or press →, for its submenu) for page breaks, recording and display of interactive-control clicks, automatic folding of identical requests (same method, URL and body; headers may differ), **Show favourites at the top** (on by default), **Show the end of long URLs** (cut long URLs at their start instead of their end, so IDs and query stay visible), **Hide query and hash** (show request and page URLs as their path only, and rules without their query conditions; hover for the full URL); **Plugins** for the site plugins working on the page: each one's on/off switch (applied from the next page load) and its own switches; and **Export**: the listed requests, or the one in the details panel (pinned, else selected), as HAR. Turn off favourites at the top to keep favourite requests in timeline order; the preference is kept across pages and restarts. Click markers identify the control type, including text fields and dropdowns. Explicit fold rules remain active when automatic folding is off. Click labels may contain page data; input values are not recorded.

## Plugins

A plugin teaches the interceptor about a site, on that site's pages only. It can:

- patch more of the page (e.g. a WebSocket) and add log entries of its own, with their own list rows and details panel (only hide, fold and favourite rules apply to them, and HAR export skips them);
- read the page's JSON responses, and answer the palette's calls from the page's memory;
- name the entities in URLs (shown as capsules in place of ids), from the page's state or responses, and recognise unknown ids by the word before them;
- add switches to **⋯ → Plugins**, sections to a request's details, minor headers and CSS.

The interface is in [`plugin.ts`](plugin.ts). Plugins are listed in [`index.ts`](index.ts): switch one off in **⋯ → Plugins** (kept across pages and restarts), or unplug it by deleting its line in `plugins` (and its folder under `plugins/`, if you like). Each plugin sets the pages it works on in its own code. Without plugins, the interceptor knows nothing about any site in particular.

Three plugins for MongoDB Atlas, each on Atlas' pages (dev, QA, prod and `localhost:8080`) and switched on and off in **⋯ → Plugins**:

### Atlas: org, project and cluster names

[`plugins/atlas-entities`](plugins/atlas-entities/atlas-entities.ts): org, project and cluster names, read from Atlas' Redux store and from API responses, shown in place of their ids in URLs; unknown ids after `groups/`, `orgId=`… are labelled by kind. Also folds away Atlas API headers rarely of interest (`x-java-version`, `x-mongodb-service-version`, `x-xgen-up-proto`).

### Atlas: Data Explorer commands (CCS)

[`plugins/atlas-ccs`](plugins/atlas-ccs/atlas-ccs.ts): the interceptor lists Data Explorer's MongoDB commands as `CCS` rows. Data Explorer (Compass Web) doesn't query clusters over HTTP: it sends MongoDB wire-protocol messages through one WebSocket to Atlas' **Cluster Connection Service** (CCS, `wss://cluster-connection.cloud.mongodb.com/ccs/<projectId>`), which forwards them to the cluster; the interceptor reads that WebSocket in the page. Each row shows the command, namespace, cluster host, status or error code, batch and write counts, sizes and browser-observed round-trip time, e.g. `find demo.orders · OK · 20 documents in first batch · 42ms`. The details panel also unfolds the whole command and reply documents (Extended JSON), kept in the page's memory like HTTP bodies and decoded only when shown. Handshakes, authentication and heartbeats are hidden unless **CCS handshakes, auth and heartbeats** is on (in **⋯ → Plugins**); hide, fold and favourite rules work on CCS rows (their URLs look like `mongodb://host:27017/demo/orders?command=find`), other rules and HAR export only cover HTTP requests. zlib-compressed messages (Atlas' `compressors=zlib`) are decompressed; snappy and zstd ones are listed but not decoded. Switching the plugin off stops recording from the next message and drops the documents kept so far.

### Atlas: analytics Segment events

[`plugins/atlas-analytics`](plugins/atlas-analytics/atlas-analytics.ts): Atlas' Segment/Heliotrope calls (`api.blue.mongodb.com`) decoded above their request body, the important parts first.

## Setup

Install [TangiTweak](https://github.com/tangistudio/TangiTweak) in your browser, then add this folder as a tweak (`package.json`'s `main` is the entry point, `index.ts`).

## Settings

| Setting | Default | |
|---|---|---|
| `shortcut` | `Mod+'` | Opens the interceptor palette. |
| `pages` | every `http`/`https` page | Where the interceptor runs. |

## Privacy

Interceptor rules and HAR exports can contain URLs, headers, request bodies and identifiers from the pages you use. Review them before sharing.
