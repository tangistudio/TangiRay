import { instrument } from "@redux-devtools/instrument";
import { compose, type Store, type StoreEnhancer } from "redux";

type ReduxDevToolsOptions = NonNullable<Parameters<typeof instrument>[1]> & {
    [option: string]: unknown;
};

interface ReduxDevToolsCompose {
    (options: ReduxDevToolsOptions): (...enhancers: StoreEnhancer[]) => StoreEnhancer;
    (...enhancers: StoreEnhancer[]): StoreEnhancer;
}

type ReduxWindow = Window & {
    __REDUX_DEVTOOLS_EXTENSION__?: (options?: ReduxDevToolsOptions) => StoreEnhancer;
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: ReduxDevToolsCompose;
};

// marks our hook functions, so a second script sees the hook is already installed
const WT_MARK = "__wtReduxHook";

const isStore = (v: any): v is Store =>
    !!v && typeof v.getState === "function" && typeof v.dispatch === "function" && typeof v.subscribe === "function";

/** The current HostRoot fiber of each of the page's React roots. */
export function* reactRoots(): Generator<any> {
    // React roots sit near the top of <body>; createRoot marks its container with __reactContainer$…
    for (const el of Array.from(document.querySelectorAll("body, body > *, body > * > *"))) {
        const key = Object.keys(el).find((k) => k.startsWith("__reactContainer$"));
        // the container keeps the root's first fiber: the FiberRoot (its stateNode) knows the current one
        const root = key ? (el as any)[key]?.stateNode?.current : (el as any)._reactRootContainer?._internalRoot?.current;
        if (root) yield root;
    }
}

/** The fibers under `root`, depth-first. */
export function* fibersOf(root: any, maxFibers: number): Generator<any> {
    let fiber = root, seen = 0;
    const stack: any[] = [];
    while (fiber && seen++ < maxFibers) {
        yield fiber;
        if (fiber.sibling) stack.push(fiber.sibling);
        fiber = fiber.child ?? stack.pop();
    }
}

// a fiber's props can be null (the root) or a string (text)
const pickIn = <T>(fiber: any, pick: (props: any) => T | undefined) => {
    const props = fiber.memoizedProps;
    return props && typeof props === "object" ? pick(props) : undefined;
};

/**
 * The first value `pick` finds in the props of a component under one of the page's React roots,
 * through React's fibers (e.g. a react-redux `<Provider store>`).
 */
export function findInReactTree<T>(pick: (props: any) => T | undefined, maxFibers = 20000): T | undefined {
    for (const root of reactRoots()) {
        for (const fiber of fibersOf(root, maxFibers)) {
            const found = pickIn(fiber, pick);
            if (found != null) return found;
        }
    }
    return undefined;
}

// fiber tags (React 18)
const CLASS = 1, HOST_ROOT = 3, HOST_COMPONENT = 5, HOST_TEXT = 6, CONTEXT_PROVIDER = 10;
const STALE = "__wtRerender";
const copy = (v: any) => (Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v);

/**
 * Renders again every component of the page's React root that has a component whose props `pick`
 * is truthy for, keeping their state (a hot reload, not a remount): what reads the page's state
 * while rendering reads it again. Not what reads it in an effect, on mount, or in a `useMemo`.
 * Returns whether a root was found.
 */
export function rerenderReactTree(pick: (props: any) => unknown, maxFibers = 20000): boolean {
    for (const root of reactRoots()) {
        const fibers = [...fibersOf(root, maxFibers)];
        if (fibers.some((f) => pickIn(f, pick)) && renderRootAgain(root, fibers)) return true;
    }
    return false;
}

/**
 * Renders again the components from `fiber`'s React root down to `fiber`, keeping their state:
 * `fiber` gets new children from its parent (e.g. to remount one given a key of its own). The
 * rest of the tree renders only where those components' output changed. Returns whether it could.
 */
export function rerenderAncestors(fiber: any): boolean {
    const path: any[] = [];
    for (let f = fiber; f; f = f.return) path.push(f, ...(f.alternate ? [f.alternate] : []));
    const root = [...reactRoots()].find((r) => path.includes(r));
    return !!root && renderRootAgain(root, path);
}

// `root.render(element)` again, with `fibers` told their props changed (see rerenderReactTree)
function renderRootAgain(root: any, fibers: Iterable<any>): boolean {
    let updater: any;
    for (const f of fibersOf(root, 20000)) {
        if (f.tag === CLASS && typeof f.stateNode?.updater?.enqueueSetState === "function") { updater = f.stateNode.updater; break; }
    }
    const element = root.memoizedState?.element;
    if (!updater || !element?.$$typeof) return false;
    // React skips a fiber whose new props are its old ones (the same object): give each a copy
    // of its old ones. Components that compare props (memo, PureComponent) are told they
    // changed by a key of their own; a context provider skips its subtree when its children
    // are the same: a copy of them too. Only compared against: the next render replaces them.
    for (const fiber of fibers) {
        const props = fiber.memoizedProps;
        if (fiber.tag === HOST_ROOT || fiber.tag === HOST_TEXT || !props || typeof props !== "object") continue;
        fiber.memoizedProps = fiber.tag === HOST_COMPONENT ? { ...props } : { ...props, [STALE]: true };
        if (fiber.tag === CONTEXT_PROVIDER) fiber.memoizedProps.children = copy(props.children);
        // a custom shouldComponentUpdate ignores that key
        if (fiber.tag === CLASS) fiber.stateNode?.forceUpdate?.();
    }
    // `root.render(element)` (React 18 updateContainer), with a copy: the same one is skipped. A
    // HostRoot takes the same updates as a class component.
    updater.enqueueSetState({ _reactInternals: root }, { element: { ...element } });
    return true;
}

/** A react-redux `<Provider store>` under one of the page's React roots. */
const findStoreInReactTree = () =>
    findInReactTree((props) => (isStore(props.store) ? props.store : isStore(props.value?.store) ? props.value.store : undefined));

export class ReduxCapture {
    // on the page's window, not in this module: a script reload re-runs this module (empty again)
    // while the hook stays installed once per page (ctx.once), so a module copy would stay empty
    static get stores(): Store[] {
        return ((window as any).__wtReduxStores ??= []);
    }

    /**
     * The first store: captured by the hook, or else read from the React tree. The hook loses the
     * race when Wiretrick's code arrives after the site's bundles ran, and a page that predates a
     * script's first run never had the hook at all.
     */
    static find(): Store | undefined {
        if (ReduxCapture.stores[0]) return ReduxCapture.stores[0];
        const store = findStoreInReactTree();
        if (store) ReduxCapture.stores.push(store);
        return store;
    }

    static installHook() {
        const reduxWindow = window as ReduxWindow;
        // every script installs it (ctx.once is per script): a second hook would capture each store twice
        if ((reduxWindow.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ as any)?.[WT_MARK]) return;

        // Chain with the real Redux DevTools extension if present.
        const origExt = reduxWindow.__REDUX_DEVTOOLS_EXTENSION__;
        const origCompose = reduxWindow.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__;

        const capture: StoreEnhancer = (createStore) => (reducer, preloadedState) => {
            const store = createStore(reducer, preloadedState);
            ReduxCapture.stores.push(store);
            return store;
        };

        const build = (options: ReduxDevToolsOptions, enhancers: StoreEnhancer[]): StoreEnhancer => {
            if (origCompose) {
                // Let the real extension instrument; we only capture the store.
                return compose(capture, origCompose(options)(...enhancers)) as StoreEnhancer;
            }
            if (origExt) {
                return compose(capture, ...enhancers, origExt(options)) as StoreEnhancer;
            }
            return compose(
                capture,
                ...enhancers,
                instrument(undefined, {
                    maxAge: options.maxAge ?? 100,
                    trace: options.trace ?? false,
                    traceLimit: options.traceLimit ?? 10,
                }),
            ) as StoreEnhancer;
        };

        reduxWindow.__REDUX_DEVTOOLS_EXTENSION__ = Object.assign((options: ReduxDevToolsOptions = {}) =>
            build(options, []), { [WT_MARK]: true });

        function devToolsCompose(options: ReduxDevToolsOptions): (...enhancers: StoreEnhancer[]) => StoreEnhancer;
        function devToolsCompose(...enhancers: StoreEnhancer[]): StoreEnhancer;
        function devToolsCompose(
            ...args: [ReduxDevToolsOptions] | StoreEnhancer[]
        ): StoreEnhancer | ((...enhancers: StoreEnhancer[]) => StoreEnhancer) {
            const first = args[0];
            if (args.length === 1 && first !== null && typeof first === "object") {
                return (...enhancers: StoreEnhancer[]) => build(first, enhancers);
            }
            return build({}, args as StoreEnhancer[]);
        }

        reduxWindow.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = Object.assign(devToolsCompose, { [WT_MARK]: true });
    }
}
