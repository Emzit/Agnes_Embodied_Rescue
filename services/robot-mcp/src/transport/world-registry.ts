import { readFileSync } from "node:fs";

export type MapPose = { x: number; y: number; yaw: number; frame_id: "map" };
export type SemanticLocation = {
  id: string; name: string; type: "start" | "room" | "corridor";
  pose: MapPose; adjacency: string[];
  bounds?: { min_x: number; max_x: number; min_y: number; max_y: number };
};
export type RegistryDocument = { version: 1; frame_id: "map"; nearest_threshold: number; locations: SemanticLocation[] };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function keys(value: any, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k=>!allowed.includes(k)))
    throw new Error("INVALID_WORLD_REGISTRY");
}

/** Static navigation semantics only. Unknown/dynamic metadata is rejected. */
export class WorldRegistry {
  private document: RegistryDocument;
  constructor(input: unknown) {
    const d = input as RegistryDocument;
    keys(d,["version","frame_id","nearest_threshold","locations"]);
    if(d.version!==1 || d.frame_id!=="map" || !finite(d.nearest_threshold) || d.nearest_threshold<=0 || !Array.isArray(d.locations) || !d.locations.length)
      throw new Error("INVALID_WORLD_REGISTRY");
    const ids=new Set<string>();
    for(const l of d.locations) {
      keys(l,["id","name","type","pose","adjacency","bounds"]);
      keys(l.pose,["x","y","yaw","frame_id"]);
      if(typeof l.id!=="string" || !l.id || typeof l.name!=="string" || !l.name || ids.has(l.id) || !["start","room","corridor"].includes(l.type)
        || ![l.pose.x,l.pose.y,l.pose.yaw].every(finite) || l.pose.frame_id!=="map" || !Array.isArray(l.adjacency)
        || l.adjacency.some(a=>typeof a!=="string") || new Set(l.adjacency).size!==l.adjacency.length)
        throw new Error("INVALID_WORLD_REGISTRY");
      ids.add(l.id);
      if(l.bounds) {
        keys(l.bounds,["min_x","max_x","min_y","max_y"]);
        if(!Object.values(l.bounds).every(finite) || l.bounds.min_x>=l.bounds.max_x || l.bounds.min_y>=l.bounds.max_y
          || !this.contains(l,l.pose)) throw new Error("INVALID_WORLD_REGISTRY");
      }
    }
    for(const l of d.locations) for(const a of l.adjacency)
      if(a===l.id || !ids.has(a) || !d.locations.find(v=>v.id===a)!.adjacency.includes(l.id)) throw new Error("INVALID_WORLD_REGISTRY");
    this.document=structuredClone(d);
  }
  static load(path: string) { return new WorldRegistry(JSON.parse(readFileSync(path,"utf8"))); }
  static historicalWaypoints(points: Record<string,{x:number;y:number;yaw?:number}>) {
    return new WorldRegistry({version:1,frame_id:"map",nearest_threshold:0.35,
      locations:Object.entries(points).map(([id,p])=>({id,name:id,type:"start",pose:{x:p.x,y:p.y,yaw:p.yaw??0,frame_id:"map"},adjacency:[]}))});
  }
  snapshot() { return structuredClone(this.document); }
  find(query: string): SemanticLocation | undefined {
    const exact = this.document.locations.find(l => l.id === query);
    if (exact) return structuredClone(exact);
    // Formatting aliases only; do not guess partial or ambiguous room names.
    const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/gu, "");
    const key = normalize(query);
    if (!key) return undefined;
    const matches = this.document.locations.filter(l => normalize(l.id) === key || normalize(l.name) === key);
    return matches.length === 1 ? structuredClone(matches[0]) : undefined;
  }
  resolve(id: string) { return this.find(id)?.pose; }
  private contains(l: SemanticLocation, p: {x:number;y:number}) {
    const b=l.bounds;
    return b && p.x>=b.min_x && p.x<b.max_x && p.y>=b.min_y && p.y<b.max_y;
  }
  locate(p: {x?:number;y?:number;frame_id?:string}): string {
    if(!finite(p.x) || !finite(p.y) || (p.frame_id && p.frame_id!=="map")) return "unknown";
    const point={x:p.x,y:p.y};
    const contained=this.document.locations.filter(l=>this.contains(l,point));
    if(contained.length===1) return contained[0].id;
    if(contained.length>1) return "unknown";
    // Bounds are authoritative; nearest matching is only for unbounded waypoints.
    const nearest=this.document.locations.filter(l=>!l.bounds).map(l=>({id:l.id,d:Math.hypot(l.pose.x-p.x!,l.pose.y-p.y!)})).sort((a,b)=>a.d-b.d);
    return nearest[0] && nearest[0].d<=this.document.nearest_threshold && (!nearest[1] || nearest[1].d>nearest[0].d) ? nearest[0].id : "unknown";
  }
  list() { return this.snapshot().locations.map(l=>({...l,kind:l.type.toUpperCase(),description:"Static navigation region in map frame",source:"semantic_map_registry"})); }
}
