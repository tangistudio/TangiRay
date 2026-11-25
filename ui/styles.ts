import { COMBOBOX_CSS } from "../shared/ui/Combobox";
import { DOCK_CSS } from "../shared/ui/dock";
import { THEME_CSS, WT_COLOR_SCHEME } from "../shared/ui/theme";
import { InterceptorPalette } from "./InterceptorPalette";
import { Capsule } from "./entities/Capsule";
import { HEADER_TABLE_CSS } from "./list/HeaderTable";

/** Styles for {@link Capsule}. */
export const ENTITY_CSS = `
.aip-cap { display: inline-flex; align-items: baseline; gap: 3px; padding: 0 5px; margin: 0 1px; border: 1px solid color-mix(in srgb, var(--wt-cap-border) 30%, var(--wt-surface)); border-radius: 9px; font: 400 11px/14px system-ui, -apple-system, sans-serif; white-space: nowrap; vertical-align: baseline; background: var(--wt-fill); color: var(--wt-text-soft); }
.aip-cap-kind { font-weight: 400; font-size: 9px; text-transform: uppercase; letter-spacing: .4px; opacity: .7; }
.aip-cap.current { border-color: color-mix(in srgb, currentColor 35%, var(--wt-surface)); }
.aip-cap.unknown { background: transparent; border: 1px dashed color-mix(in srgb, var(--wt-border) 30%, var(--wt-surface)); color: var(--wt-text-muted); }
`;

/** Styles for {@link InterceptorPalette}; add with `ctx.style`. */
export const INTERCEPTOR_PALETTE_CSS = THEME_CSS + ENTITY_CSS + COMBOBOX_CSS + HEADER_TABLE_CSS + `
.aip-backdrop { ${WT_COLOR_SCHEME} position: fixed; inset: 0; background: rgba(0, 30, 43, .45); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; z-index: 2147483647; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
.aip-root { position: relative; width: min(1400px, 96vw); height: 80vh; display: flex; flex-direction: column; background: var(--wt-surface); color: var(--wt-text); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.35); overflow: hidden; }
/* the list behind an editor: laid out at its size (so it keeps its scroll), but not seen nor reachable */
.aip-root.aip-behind { position: absolute; top: 0; visibility: hidden; pointer-events: none; }
[data-wt-dock] > .aip-root.aip-behind { width: var(--wt-dock-width); height: 100vh; }
.aip-flash-a > .aip-root::after, .aip-flash-b > .aip-root::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 20; box-shadow: inset 0 0 0 3px var(--wt-yellow-strong), inset 0 0 28px color-mix(in srgb, var(--wt-yellow-strong) 40%, transparent); background: color-mix(in srgb, var(--wt-yellow-strong) 14%, transparent); }
.aip-flash-a > .aip-root::after { animation: aip-flash-a 650ms ease-out both; }
.aip-flash-b > .aip-root::after { animation: aip-flash-b 650ms ease-out both; }
@keyframes aip-flash-a { 0%, 100% { opacity: 0; } 18%, 62% { opacity: 1; } 40% { opacity: .2; } }
@keyframes aip-flash-b { 0%, 100% { opacity: 0; } 18%, 62% { opacity: 1; } 40% { opacity: .2; } }
.aip-root code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; word-break: break-all; }
.aip-header { display: flex; align-items: center; padding-right: 14px; border-bottom: 1px solid var(--wt-border-soft); }
.aip-header [cmdk-input] { flex: 1; min-width: 0; width: 100%; box-sizing: border-box; border: 0; outline: 0; padding: 14px 16px; font-size: 15px; background: transparent; color: inherit; }
.aip-body { display: flex; flex: 1; min-height: 0; }
.aip-root [cmdk-list] { overflow: auto; flex: 1 1 0; min-width: 0; padding: 6px; }
.aip-details { flex: 0 0 var(--aip-details-size, 45%); box-sizing: border-box; min-width: 0; overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.aip-details.empty { align-items: center; justify-content: center; color: var(--wt-text-faint); }
.aip-details.switching { opacity: .6; transition: opacity .15s .1s; }
.aip-details-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aip-details-head .aip-seq { width: auto; margin-left: auto; }
.aip-details-url { display: block; line-height: 1.6; }
.aip-details-rules { display: flex; flex-wrap: wrap; gap: 4px; }
.aip-root button.aip-rule-link { margin: 0; border: 0; font-family: inherit; cursor: pointer; }
.aip-root button.aip-rule-link:hover { text-decoration: underline; }
.aip-root button.aip-rule-link.idle { opacity: .55; }
.aip-details-folded { padding: 6px 8px; border-radius: 6px; background: var(--wt-fill); box-shadow: inset 3px 0 0 var(--wt-border); }
.aip-details-group { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px 8px; border: 1px solid var(--wt-border-soft); border-radius: 8px; }
.aip-details-group-head { padding-bottom: 4px; border-bottom: 1px solid var(--wt-border-soft); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-soft); }
.aip-fold-section > summary { display: flex; align-items: baseline; gap: 6px; margin: 2px 0; cursor: pointer; list-style: none; }
.aip-fold-section > summary::-webkit-details-marker { display: none; }
.aip-fold-section > summary::before { content: "▸"; flex: none; width: 10px; color: var(--wt-text-muted); transition: transform .12s; }
.aip-fold-section[open] > summary::before { transform: rotate(90deg); }
.aip-fold-section[open] > summary { margin-bottom: 4px; }
.aip-fold-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-details-section h4 { margin: 6px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-badge.on { background: var(--wt-green-bg); color: var(--wt-green); }
.aip-preview-name { font: 600 13px ui-monospace, Menlo, monospace; min-width: 0; overflow-wrap: anywhere; }
.aip-preview-action { font-weight: 600; margin-bottom: 4px; }
.aip-preview-matches { display: flex; flex-direction: column; }
.aip-preview-match { display: flex; align-items: center; gap: 8px; padding: 1px 0; min-width: 0; }
.aip-root button.aip-preview-match { width: 100%; margin: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.aip-root button.aip-preview-match.idle { opacity: .55; }
.aip-root button.aip-preview-match:is(:hover, :focus-visible) { background: var(--wt-fill); }
.aip-preview-match .aip-seq { width: 40px; }
.aip-preview-match .aip-title { flex: 1; min-width: 0; }
.aip-table { border-collapse: collapse; width: 100%; font: 11px/1.5 ui-monospace, Menlo, monospace; }
.aip-table th { text-align: left; vertical-align: top; color: var(--wt-text-muted); font-weight: 500; padding: 1px 10px 1px 0; white-space: nowrap; }
.aip-table td { word-break: break-all; padding: 1px 0; }
.aip-pre { display: block; width: 100%; box-sizing: border-box; margin: 0; padding: 8px; background: var(--wt-fill-soft); color: var(--wt-text); border: 1px solid var(--wt-border-soft); border-radius: 6px; font: 11px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto; resize: none; field-sizing: content; }
.aip-pre:focus { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-pre::placeholder { color: var(--wt-text-muted); }
.aip-root [cmdk-group-heading] { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-root [cmdk-item] { display: flex; align-items: center; gap: 8px; padding: 3px 8px; border-radius: 5px; cursor: pointer; line-height: 1.3; }
.aip-root [cmdk-item][data-selected="true"] { background: var(--wt-green-bg); }
/* while a request is pinned, the details follow the pin, not the selection: the selected row only shows what a click or key acts on */
.aip-root.aip-pinning [cmdk-item][data-selected="true"] { background: var(--wt-fill); }
.aip-root [cmdk-item].aip-picked { background: var(--wt-blue-bg); box-shadow: inset 3px 0 0 var(--wt-accent); }
.aip-root [cmdk-item].aip-hidden { opacity: .5; }
.aip-root [cmdk-item].aip-unfolded { box-shadow: inset 3px 0 0 var(--wt-border); }
.aip-root [cmdk-item].aip-pinned { box-shadow: inset 3px 0 0 var(--wt-blue), inset 0 0 0 1px var(--wt-blue); }
/* the line's height (16px in a ~17px line): showing it doesn't make the header taller */
.aip-details-head .aip-pin { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; box-sizing: border-box; margin: -2px 0; padding: 0; border: 1px solid var(--wt-blue); border-radius: 50%; background: var(--wt-blue-bg); cursor: pointer; font-size: 9px; line-height: 1; }
.aip-details-head .aip-pin:hover { filter: brightness(1.2); }
.aip-request-gap { display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 5px 8px; border-radius: 5px; background: var(--wt-fill); color: var(--wt-text-soft); font-size: 11px; font-weight: 600; }
.aip-request-gap::before, .aip-request-gap::after { content: ""; flex: 1; border-top: 1px solid var(--wt-border); }
.aip-page-marker { position: sticky; top: -6px; z-index: 1; margin-inline: -6px; padding-inline: 14px; border-radius: 0; }
.aip-root [cmdk-item] { scroll-margin-top: 32px; }
.aip-navigation-url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* "Show the end of long URLs": right-to-left puts the overflow on the left; EnrichedUrl keeps the URL itself left-to-right */
.aip-url-tail .aip-clip-url { direction: rtl; text-align: left; }
.aip-root button.aip-fold { flex: none; margin: 0; padding: 0 7px; border: 1px solid var(--wt-border); border-radius: 9px; background: var(--wt-fill); color: var(--wt-text-soft); font: 600 11px/16px system-ui, -apple-system, sans-serif; cursor: pointer; }
.aip-root button.aip-fold .aip-fold-action { display: none; }
.aip-root button.aip-fold:not(.open):is(:hover, :focus-visible) .aip-fold-count { display: none; }
.aip-root button.aip-fold:not(.open):is(:hover, :focus-visible) .aip-fold-action { display: inline; }
.aip-root button.aip-fold.open { background: transparent; font-weight: 500; color: var(--wt-text-faint); }
.aip-root [cmdk-empty] { padding: 24px; text-align: center; color: var(--wt-text-muted); }
.aip-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.aip-title { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aip-sub { color: var(--wt-text-muted); font-size: 11px; line-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aip-seq { flex: none; width: 36px; color: var(--wt-text-faint); font-size: 11px; text-align: right; }
.aip-method { flex: none; min-width: 44px; font-size: 11px; font-weight: 600; color: var(--wt-accent); }
.aip-status { flex: none; min-width: 28px; text-align: right; font-weight: 600; font-size: 12px; color: var(--wt-text-faint); }
.aip-status.s2 { color: var(--wt-green); } .aip-status.s3 { color: var(--wt-accent); } .aip-status.s4 { color: var(--wt-yellow); } .aip-status.s5 { color: var(--wt-red); }
.aip-time { flex: none; width: 56px; text-align: right; color: var(--wt-text-faint); font-size: 11px; }
.aip-badge { flex: none; font-size: 10px; line-height: 14px; text-transform: uppercase; letter-spacing: .4px; padding: 0 5px; border-radius: 4px; background: var(--wt-fill); color: var(--wt-text-muted); }
.aip-badge.tag { background: var(--wt-blue-bg); color: var(--wt-blue); text-transform: none; }
.aip-badge.paused { background: var(--wt-yellow-bg); color: var(--wt-yellow); }
.aip-switch { display: inline-block; flex: none; width: 24px; height: 14px; border-radius: 7px; background: var(--wt-border); position: relative; transition: background .15s; }
.aip-root button.aip-star { flex: none; width: 16px; margin: 0 -4px 0 0; padding: 0; border: 0; background: transparent; color: var(--wt-text-faint); font-size: 13px; line-height: 1; cursor: pointer; visibility: hidden; }
.aip-root [cmdk-item]:hover .aip-star, .aip-root [cmdk-item][data-selected="true"] .aip-star, .aip-root button.aip-star.on { visibility: visible; }
.aip-root button.aip-star:hover { color: var(--wt-text); }
.aip-root button.aip-star.on { color: var(--wt-yellow-strong); }
.aip-switch.mixed { background: var(--wt-green-border); }
.aip-switch.mixed::after { left: 7px; }
.aip-root button.aip-chevron { flex: none; width: 14px; margin: 0 -4px 0 0; padding: 0; border: 0; background: transparent; color: var(--wt-text-muted); font-size: 10px; line-height: 1; cursor: pointer; }
.aip-folder-name { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.aip-root input.aip-rename { font: 600 13px system-ui, -apple-system, sans-serif; letter-spacing: .01em; padding: 1px 4px; border: 1px solid var(--wt-accent); border-radius: 4px; background: var(--wt-surface); color: var(--wt-text); outline: none; }
.aip-root [cmdk-item].aip-drop-into { background: var(--wt-blue-bg); box-shadow: inset 0 0 0 2px var(--wt-accent); }
.aip-root [cmdk-item]:is(.aip-drop-before, .aip-drop-after) { position: relative; }
.aip-root [cmdk-item]:is(.aip-drop-before, .aip-drop-after)::before { content: ""; position: absolute; left: var(--aip-indent, 0px); right: 0; height: 2px; background: var(--wt-accent); pointer-events: none; }
.aip-root [cmdk-item].aip-drop-before::before { top: 0; }
.aip-root [cmdk-item].aip-drop-after::before { bottom: 0; }
.aip-root [cmdk-item][draggable="true"] { cursor: grab; }
.aip-root [cmdk-list].aip-drop-end::after { content: ""; display: block; height: 2px; background: var(--wt-accent); }
.aip-hides-icon { flex: none; width: 24px; text-align: center; font-size: 13px; opacity: .6; }
.aip-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: left .15s; }
.aip-switch.on { background: var(--wt-green-strong); }
.aip-switch.on::after { left: 12px; }
.aip-icon { flex: none; border: 0; background: transparent; cursor: pointer; color: var(--wt-text-muted); padding: 0 5px; line-height: 18px; border-radius: 4px; font-size: 13px; }
.aip-icon:hover { background: var(--wt-border-soft); color: var(--wt-text); }
.aip-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 8px; padding: 8px 14px; border-top: 1px solid var(--wt-border-soft); color: var(--wt-text-muted); font-size: 12px; }
.aip-root button:not(.aip-icon):not(.aip-star):not(.aip-link):not(.aip-fold):not(.aip-tool):not(.aip-tab):not(.aip-chevron):not(.aip-mode-switch):not(.aip-rule-link):not(.aip-pin):not(.aip-preview-match):not(.wt-dock-button):not(.wt-dock-close):not([role=menuitem]):not([role=menuitemcheckbox]):not(.cm-editor *):not(.aip-quiet) { margin-left: 6px; padding: 4px 12px; border: 1px solid var(--wt-border); border-radius: 6px; background: var(--wt-surface); color: inherit; cursor: pointer; font: inherit; color: inherit; }
.aip-root button.aip-resume { border-color: var(--wt-yellow-strong); background: var(--wt-yellow-bg); font-weight: 600; }
.aip-root button.aip-failed { border-color: var(--wt-red-strong); color: var(--wt-red); }
.aip-root button.primary { background: var(--wt-green); border-color: var(--wt-green); color: var(--wt-surface); }
.aip-root button:disabled:not(.cm-editor *) { opacity: .5; cursor: default; }
.aip-editor-title { flex: none; box-sizing: border-box; height: 52px; padding: 0 16px; border-bottom: 1px solid var(--wt-border-soft); display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; overflow: hidden; white-space: nowrap; font-weight: 600; }
.aip-editor-title code { font-weight: normal; }
.aip-form { overflow: auto; flex: 1; padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
.aip-footer > span:last-child { margin-left: auto; }
.aip-form section { padding: 8px 0; border-bottom: 1px solid var(--wt-fill); display: flex; flex-direction: column; gap: 6px; }
.aip-form h4 { margin: 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); display: flex; justify-content: space-between; }
.aip-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--wt-text-muted); flex: 1; }
.aip-form label.narrow { flex: 0 0 90px; }
/* directly in the (column) form: as tall as its field, not stretched */
.aip-form label.aip-pause-status { flex: none; }
.aip-form input:not([type=checkbox]):not([type=radio]):not(.cm-editor *), .aip-form textarea, .aip-form select { font: 12px ui-monospace, Menlo, monospace; padding: 6px 8px; border: 1px solid var(--wt-border); border-radius: 6px; color: var(--wt-text); background: var(--wt-surface); }
.aip-form textarea { resize: vertical; }
.aip-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--wt-text-muted); }
.aip-mode { margin-left: auto; display: inline-flex; align-items: center; gap: 0; font-weight: normal; }
.aip-root button.aip-mode-switch { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 4px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--wt-text-muted); font: 500 12px system-ui, -apple-system, sans-serif; cursor: pointer; }
.aip-root button.aip-mode-switch:hover { background: var(--wt-fill-soft); color: var(--wt-text); }
.aip-root button.aip-mode-switch[aria-checked="true"] { color: var(--wt-text); }
.aip-root button.aip-mode-switch:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
/* clicks on empty space focus the editor itself (tabIndex -1), so its keys keep working */
.aip-editor:focus { outline: none; }
.aip-editor .aip-kbd { visibility: hidden; }
.aip-editor.show-keys .aip-kbd { visibility: visible; }
.aip-rule-title { gap: 12px; }
.aip-title-field { flex: 1; display: flex; align-items: center; min-width: 0; }
.aip-rule-title input { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; }
.aip-rule-title input:hover { border-color: var(--wt-border-soft); }
.aip-rule-title input:focus { outline: none; border-color: var(--wt-accent); background: var(--wt-surface); }
.aip-rule-title input.aip-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; }
.aip-rule-title input.aip-tags { flex: 0 1 200px; min-width: 80px; width: 200px; font-size: 12px; font-weight: normal; }
.aip-form.aip-rule { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 12px; align-items: start; padding-top: 12px; }
.aip-form.aip-rule .aip-wide { grid-column: 1 / -1; }
.aip-form .aip-card, .aip-rule-preview .aip-card { border: 1px solid var(--wt-border-soft); border-radius: 10px; padding: 10px 12px; gap: 10px; }
.aip-form .aip-card h4 { margin: 0; }
/* the rule preview: the editor's cards, read only */
.aip-rule-preview .aip-card { display: flex; flex-direction: column; flex: none; }
.aip-rule-preview .aip-card h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-pattern-view { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border: 1px solid var(--wt-border); border-radius: 6px; }
.aip-pattern-view .aip-method { min-width: 0; }
.aip-rule-preview .aip-part { cursor: default; }
.aip-rule-preview .aip-part:hover { background: none; }
.aip-rule-preview .aip-param-key { cursor: default; }
.aip-url { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; background: var(--wt-fill-soft); border: 1px solid var(--wt-border-soft); border-radius: 8px; }
.aip-form .aip-url select.aip-method-pick, .aip-form .aip-pattern-row select.aip-method-pick { flex: none; padding: 2px 4px; font-weight: 600; color: var(--wt-accent); }
.aip-pattern-row { display: flex; align-items: center; gap: 8px; }
.aip-form input.aip-pattern { flex: 1; min-width: 0; font: 12px ui-monospace, Menlo, monospace; }
.aip-form input.aip-pattern.invalid { border-color: var(--wt-red); }
.aip-example { align-items: baseline; }
.aip-example-label { flex: none; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-url-text { flex: 1; min-width: 0; font: 12px/24px ui-monospace, Menlo, monospace; word-break: break-all; }
.aip-part { border-radius: 4px; padding: 1px 2px; cursor: pointer; }
.aip-part:hover { background: var(--wt-fill); }
.aip-part.any { background: var(--wt-yellow-bg); color: var(--wt-yellow); }
.aip-origin.any { text-decoration: line-through; }
.aip-segment.many { background: var(--wt-purple-bg); color: var(--wt-purple); }
.aip-param.on { color: var(--wt-text); }
.aip-param.any { opacity: 1; color: var(--wt-text-muted); }
.aip-param-key { display: inline-flex; align-items: center; gap: 3px; margin: 0 1px; padding: 0 5px 0 3px; border: 1px dashed var(--wt-border); border-radius: 10px; cursor: pointer; line-height: 18px; }
.aip-param-key:hover { border-color: var(--wt-accent); color: var(--wt-accent); }
.aip-param.on .aip-param-key { border-style: solid; border-color: var(--wt-green); background: var(--wt-green-bg); color: var(--wt-green); }
.aip-param-mark { display: inline-block; width: 12px; text-align: center; font: 600 11px system-ui, -apple-system, sans-serif; }
.aip-param-key:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-form input.aip-param-value { padding: 0 4px; font: 12px ui-monospace, Menlo, monospace; border-radius: 4px; width: auto; }
.aip-part:focus-visible, .aip-part [role=button]:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-link.aip-small { font-size: 12px; }
.aip-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aip-form .aip-chip { flex: none; flex-direction: row; align-items: center; gap: 5px; padding: 3px 9px 3px 7px; border: 1px solid var(--wt-border); border-radius: 14px; color: var(--wt-text); cursor: pointer; position: relative; }
.aip-action-icon { flex: none; opacity: .85; }
/* the ⌥ key: a corner badge on the chip, so it takes no room in it */
.aip-chip .aip-kbd { position: absolute; top: -7px; right: -6px; margin: 0; background: var(--wt-surface); }
.aip-chip input { position: absolute; opacity: 0; pointer-events: none; }
.aip-chip.on { background: var(--wt-green-bg); border-color: var(--wt-green); color: var(--wt-green); }
.aip-chip:focus-within { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-action-groups { display: grid; grid-template-columns: max-content 1fr; align-items: center; gap: 6px 10px; }
.aip-action-group { display: contents; }
.aip-action-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
/* a pause's "At" and "Do" switches: small chips, a label before them */
.aip-segmented-label { flex: 0 0 24px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-text-muted); }
.aip-form .aip-segmented .aip-chip { padding: 2px 10px; }
.aip-form .aip-chip.disabled { opacity: .45; cursor: not-allowed; }
.aip-form .aip-action-group.list .aip-chip:not(.on) { border-style: dashed; color: var(--wt-text-muted); }
.aip-action-detail { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 10px 12px; border: 1px solid var(--wt-border-soft); border-left: 3px solid var(--wt-green); border-radius: 8px; background: var(--wt-fill-soft); }
.aip-action-detail-head { display: flex; flex-direction: column; gap: 2px; }
.aip-action-detail-title { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--wt-green); }
.aip-action-fields:empty { display: none; }
.aip-action-fields { display: flex; flex-direction: column; gap: 8px; }
.aip-preview { padding: 4px 8px; background: var(--wt-fill-soft); border: 1px solid var(--wt-border-soft); border-radius: 6px; }
.aip-mode .aip-kbd { margin-right: 4px; }
.aip-row { display: flex; gap: 12px; }
.aip-form .aip-check { display: flex; flex-direction: row; align-items: center; gap: 6px; color: var(--wt-text); }
.aip-form .aip-pick { padding: 2px 6px; border-radius: 5px; cursor: pointer; }
.aip-form .aip-pick:hover { background: var(--wt-fill-soft); }
.aip-form .aip-pick-all { border-bottom: 1px solid var(--wt-border-soft); border-radius: 6px 6px 0 0; margin-bottom: 2px; }
.aip-form .aip-pick-all .aip-title { font-family: inherit; font-weight: 600; }
.aip-form input.aip-export-search { font: 13px system-ui, -apple-system, sans-serif; }
.aip-form .aip-check label { flex-direction: row; align-items: center; gap: 6px; flex: none; color: var(--wt-text); }
.aip-form input.aip-inline { width: 140px; padding: 3px 6px; }
.aip-form input.aip-inline.wide { flex: 1; width: auto; }
.aip-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.aip-segments { display: inline; }
.aip-segments.off { opacity: .5; }
.aip-segment { border: 1px solid transparent; background: var(--wt-fill); border-radius: 4px; padding: 1px 4px; margin-right: 2px; cursor: pointer; font: 12px/22px ui-monospace, Menlo, monospace; color: var(--wt-text); }
.aip-segment.any { background: var(--wt-yellow-bg); border-color: var(--wt-yellow-strong); }
.aip-segments.off .aip-segment { cursor: default; }
.aip-segment:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-count { font-weight: 500; color: var(--wt-text-faint); }
.aip-tabs { flex: none; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--wt-border-soft); }
.aip-root button.aip-tab { margin: 0 0 -1px; padding: 7px 10px 6px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--wt-text-muted); font: 500 12px system-ui, -apple-system, sans-serif; cursor: pointer; }
.aip-root button.aip-tab:hover { color: var(--wt-text); }
.aip-root button.aip-tab.on { color: var(--wt-text); border-bottom-color: var(--wt-accent); font-weight: 600; }
.aip-tab-hint { display: inline-flex; gap: 2px; margin-left: 4px; }
.aip-tab-hint kbd { font: 10px/14px ui-monospace, Menlo, monospace; padding: 0 4px; border: 1px solid var(--wt-border); border-radius: 3px; color: var(--wt-text-faint); }
.aip-head-tools { margin-left: auto; display: inline-flex; gap: 4px; text-transform: none; letter-spacing: 0; }
.aip-root button.aip-tool { margin: 0; padding: 1px 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--wt-text-muted); font: 500 11px/16px system-ui, -apple-system, sans-serif; cursor: pointer; }
.aip-root button.aip-tool:hover:not(:disabled) { border-color: var(--wt-border); color: var(--wt-text); }
.aip-root button.aip-tool.on { background: var(--wt-yellow-bg); border-color: var(--wt-yellow-border); color: var(--wt-yellow); }
.aip-root button.aip-tool:disabled { opacity: .4; cursor: default; }
.aip-footer-actions { display: inline-flex; align-items: center; }
/* the pause dialog: options above its footer, secondary actions quiet on the footer's left */
.aip-pause-options { display: flex; flex-wrap: wrap; gap: 4px 18px; padding-top: 4px; }
.aip-field-head { display: flex; align-items: baseline; justify-content: space-between; }
.aip-root button.aip-quiet { margin-left: 6px; padding: 4px 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--wt-text-muted); cursor: pointer; font: inherit; }
.aip-root button.aip-quiet:first-child { margin-left: 0; }
.aip-root button.aip-quiet:hover { border-color: var(--wt-border); color: var(--wt-text); }
.aip-btn-key { margin-left: 6px; padding: 0 4px; border: 1px solid var(--wt-border-soft); border-radius: 4px; color: var(--wt-text-faint); font: 10px/14px system-ui, -apple-system, sans-serif; }
.aip-root button.primary .aip-btn-key { border-color: color-mix(in srgb, var(--wt-surface) 45%, transparent); color: inherit; opacity: .8; }
/* the ⋯ menu (ui/MoreMenu.tsx): its popovers are placed in the fixed layer */
.aip-menu-layer { position: fixed; inset: 0; z-index: 20; pointer-events: none; }
.aip-menu-popover { pointer-events: auto; min-width: 240px; background: var(--wt-surface); border: 1px solid var(--wt-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.25); outline: none; }
.aip-menu { display: flex; flex-direction: column; max-height: inherit; overflow: auto; padding: 4px; outline: none; }
.aip-menu-item { display: flex; border-radius: 4px; color: var(--wt-text); font: 13px/18px system-ui, -apple-system, sans-serif; cursor: default; outline: none; }
.aip-menu-content { flex: 1; display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 8px; }
.aip-menu-icon { width: 16px; text-align: center; color: var(--wt-text-muted); }
.aip-menu-sep { height: 1px; margin: 4px 6px; background: var(--wt-border-soft); }
.aip-menu-chevron { margin-left: auto; color: var(--wt-text-muted); }
.aip-menu-item[data-open]:not([data-focused]) { background: var(--wt-fill-strong); }
.aip-menu-item[data-focused] { background: var(--wt-accent); color: #fff; }
.aip-menu-item[data-focused] :is(.aip-menu-icon, .aip-menu-chevron) { color: inherit; }
.aip-menu-item[data-disabled] { color: var(--wt-text-faint); }
.aip-menu-item.aip-failed { color: var(--wt-red); }
.aip-kbd { flex: none; margin-left: 4px; padding: 0 4px; border: 1px solid var(--wt-border-soft); border-radius: 4px; color: var(--wt-text-faint); font: 10px/16px system-ui, -apple-system, sans-serif; }
.aip-form :is(input, textarea, select):not(.cm-editor *):focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
.aip-pattern { padding: 4px 8px; background: var(--wt-fill-soft); border: 1px solid var(--wt-border-soft); border-radius: 6px; color: var(--wt-text); cursor: text; }
.aip-link { align-self: flex-start; border: 0; background: transparent; color: var(--wt-accent); cursor: pointer; padding: 0; font: inherit; }
.aip-hint { font-size: 12px; color: var(--wt-text-muted); font-weight: normal; text-transform: none; letter-spacing: 0; }
.aip-error { color: var(--wt-red); font-size: 12px; }
.aip-body.stacked { flex-direction: column; }
.aip-body.stacked > * { min-height: 0; }
.aip-splitter { flex: none; position: relative; width: 1px; background: var(--wt-border-soft); cursor: col-resize; touch-action: none; }
.aip-splitter::before { content: ""; position: absolute; inset: 0 -3px; z-index: 1; }
.aip-splitter:hover, .aip-splitter:active { background: var(--wt-accent); box-shadow: 0 0 0 1px var(--wt-accent); }
.aip-splitter.stacked { box-sizing: border-box; width: auto; height: 7px; border-block: 1px solid var(--wt-border-soft); background: var(--wt-fill); cursor: row-resize; }
.aip-splitter.stacked::before { inset: -2px 0; }
.aip-splitter.stacked::after { content: ""; position: absolute; left: 50%; top: 1px; width: 32px; height: 3px; margin-left: -16px; border-radius: 2px; background: var(--wt-border); }
.aip-splitter.stacked:hover, .aip-splitter.stacked:active { border-color: var(--wt-accent); background: color-mix(in srgb, var(--wt-accent) 25%, var(--wt-fill)); box-shadow: none; }
.aip-splitter.stacked:hover::after, .aip-splitter.stacked:active::after { background: var(--wt-accent); }
` + DOCK_CSS;
