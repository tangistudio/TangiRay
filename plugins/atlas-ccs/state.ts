import { tweak } from "tangitweak";

/** Kept across pages and restarts. */
export const ccsPrefs = tweak.globalStore<{ showBackground?: boolean }>("atlas-ccs-prefs", {});
