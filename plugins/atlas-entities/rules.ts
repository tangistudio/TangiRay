import { parseExtractRules } from "../../domain/entities";

// -------------------------------------------------------------------------------------------------
// ENTITY RULES
// Where to find Atlas' entities shown as capsules in API URLs; syntax in ../../domain/entities.ts.
// The Log shows how many entities each rule found.
// -------------------------------------------------------------------------------------------------

// `<kind> <path> [id=…] [name=…] [parent=…] [when=…]`, from Atlas' Redux state
export const ENTITY_RULES = parseExtractRules([
    "org      organization.*                  id=$key           name=data.name",
    "project  group.*                         id=$key           name=data.name",
    "project  nds.groupStatus.groupStatus     id=id             name=groupName",
    "cluster  nds.clusterDescriptions.*.data  id=uniqueId,name  name=name  parent=groupId",
    "cluster  allClusters.**                  id=uniqueId,name  name=name  parent=groupId  when=name,groupId,clusterType",
    "user     viewer                          id=id             name=firstName+lastName|username",
    "current  app.activeOrgId",
    "current  app.activeGroupId",
    "current  viewer.id",
]);

// `<URLPattern> <kind> <path> …`, from the page's JSON API responses ($ = the body); kept until the page reloads
export const RESPONSE_ENTITY_RULES = parseExtractRules([
    "# https://cloud*.mongodb.com/*/search/indexes*  search-index  *  id=indexID,name  name=name  parent=collectionName",
], { withUrl: true });

export const responseRulePatterns = RESPONSE_ENTITY_RULES.map((r) => new URLPattern(r.url!));
