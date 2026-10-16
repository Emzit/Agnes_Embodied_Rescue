export type SchemaNode = {
  type: "object" | "string" | "array";
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
};

// These are contract documentation schemas, not an MCP SDK implementation.
export const ROBOT_TOOL_SCHEMAS: Record<string, SchemaNode> = {
  get_robot_state: { type: "object", properties: {}, required: [] },
  get_world_state: { type: "object", properties: {}, required: [] },
  get_observation: {
    type: "object",
    properties: { object_id: { type: "string" } },
    required: [],
  },
  navigate_to: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  inspect_room: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  inspect_object: {
    type: "object",
    properties: { object_id: { type: "string" } },
    required: ["object_id"],
  },
  stop_robot: { type: "object", properties: {}, required: [] },
  list_known_locations: { type: "object", properties: {}, required: [] },
};
