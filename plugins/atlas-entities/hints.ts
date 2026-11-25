import type { EntityHints } from "../../domain/entities";

// -------------------------------------------------------------------------------------------------
// ATLAS ENTITY HINTS
// Unknown ids in Atlas URLs, by the word before them ("groups/<id>", "orgId=<id>"), and the colors
// of Atlas' entity kinds.
// -------------------------------------------------------------------------------------------------

const PROJECT = "project", ORG = "org", CLUSTER = "cluster";

export const ATLAS_HINTS: EntityHints = {
    opaqueId: /^[0-9a-f]{24}$/,
    // "clusters/<id>" is usually a project id in Atlas URLs: not listed
    kindBefore: {
        groups: PROJECT, group: PROJECT, groupid: PROJECT, projects: PROJECT, project: PROJECT, projectid: PROJECT,
        orgs: ORG, org: ORG, orgid: ORG, organizations: ORG, organization: ORG, organizationid: ORG,
        clusterid: CLUSTER, clustername: CLUSTER,
    },
    nameAfter: { clustername: CLUSTER },
    styledKinds: [ORG, PROJECT, CLUSTER, "user"],
};

export const ATLAS_ENTITY_CSS = `
.aip-cap.org { background: color-mix(in srgb, var(--wt-purple-bg) 45%, var(--wt-surface)); border-color: color-mix(in srgb, var(--wt-purple-border) 30%, var(--wt-surface)); color: color-mix(in srgb, var(--wt-purple) 40%, var(--wt-text-soft)); }
.aip-cap.project { background: color-mix(in srgb, var(--wt-blue-bg) 45%, var(--wt-surface)); border-color: color-mix(in srgb, var(--wt-blue-border) 30%, var(--wt-surface)); color: color-mix(in srgb, var(--wt-blue) 40%, var(--wt-text-soft)); }
.aip-cap.cluster { background: color-mix(in srgb, var(--wt-green-bg) 45%, var(--wt-surface)); border-color: color-mix(in srgb, var(--wt-green-border) 30%, var(--wt-surface)); color: color-mix(in srgb, var(--wt-green) 40%, var(--wt-text-soft)); }
.aip-cap.user { background: color-mix(in srgb, var(--wt-yellow-bg) 45%, var(--wt-surface)); border-color: color-mix(in srgb, var(--wt-yellow-border) 30%, var(--wt-surface)); color: color-mix(in srgb, var(--wt-yellow) 40%, var(--wt-text-soft)); }
`;
