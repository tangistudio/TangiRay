import { ACTION_GROUPS, ACTIONS, type EditorAction } from "./draft";

// functions, not elements: the page world loads this module too, and may not call React then
const PATHS: Record<EditorAction, () => React.ReactNode> = {
    pause: () => <path d="M9 5v14M15 5v14" />,
    mock: () => <path d="M10 7l-5 5 5 5M5 12h9a5 5 0 0 1 5 5v1" />,
    delay: () => <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    favourite: () => <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
    fold: () => <path d="M7 20l5-5 5 5M7 4l5 5 5-5" />,
    hide: () => <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path d="M3 3l18 18" /></>,
};

/** An action's outline icon, in the text's color. */
export const ActionIcon = ({ choice }: { choice: EditorAction }) => (
    <svg className="aip-action-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{PATHS[choice]()}</svg>
);

/** The selected action's panel heading, in the editor and the rule preview: its icon, group and name, and what it does. */
export function ActionHeading({ choice }: { choice: EditorAction }) {
    const action = ACTIONS.find((a) => a.choice === choice);
    const group = ACTION_GROUPS.find((g) => g.id === action?.group);
    return (
        <div className="aip-action-detail-head">
            <span className="aip-action-detail-title"><ActionIcon choice={choice} />{group?.id === "list" ? `${group.label} · ` : ""}{action?.label}</span>
            <span className="aip-hint">{action?.hint}</span>
        </div>
    );
}
