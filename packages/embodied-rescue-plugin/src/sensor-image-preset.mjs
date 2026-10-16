/** Native Agnes Harness presets for sensor inference and externally staged demos. */
export const presets = {
  // Stages and evidence are verified by the demo controller; retain normal tools,
  // the T0 verifier and native approval policy without automatic Harness edits.
  "recorded-demo": {
    name: "recorded-demo",
    extends: "standard",
    surfaces: ["sdk", "daemon"],
    completion_gate: { enabled: false, min_items: 0 },
    harness: { auto_refine: { enabled: false } },
  },
  "sensor-image": {
    name: "sensor-image",
    extends: "standard",
    surfaces: ["sdk", "daemon"],
    disclosure: "none",
    model: {
      prompt_sections: [],
      max_tokens: 2048,
      timeout_ms: 30000,
      retry: { max_attempts: 1 },
    },
    tools: { core: [] },
    budget: { max_steps: 1 },
    completion_gate: { enabled: false, min_items: 0 },
    compaction: { enabled: false, agent_callable: false },
    harness: { auto_refine: { enabled: false } },
    skills_roots: [],
  },
};
