import { createCognitiveBackendTools } from './src/backend/tools.ts'
import { createTargetEvidence } from './src/backend/target-evidence.mjs'

const Kind = Symbol.for('TypeBox.Kind')

const string = () => ({ [Kind]: 'String', type: 'string' })
const number = (minimum = 0, maximum = 1) => ({ [Kind]: 'Number', type: 'number', minimum, maximum })
const unknownObject = () => ({
  [Kind]: 'Object',
  type: 'object',
  properties: {},
  additionalProperties: true,
})
const object = (properties, required = []) => ({
  [Kind]: 'Object',
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const array = (items) => ({
  [Kind]: 'Array',
  type: 'array',
  items,
})

const emptyInput = object({})
const missionResetParameters = object({
  mission_id: string(),
  goal: string(),
})
const worldMemoryUpdateParameters = object(
  {
    robot_location: string(),
    searched_room: string(),
    blocked_route: unknownObject(),
    known_object: unknownObject(),
    detected_hazard: unknownObject(),
    target_status: string(),
    action: unknownObject(),
    replan: { [Kind]: 'Boolean', type: 'boolean' },
    active_perception: { [Kind]: 'Boolean', type: 'boolean' },
    last_observation: string(),
    current_plan: array(unknownObject()),
  },
)
const decisionParameters = object({
  goal: string(),
  world_state: unknownObject(),
  candidates: array(object({
    id: string(),
    type: string(),
    target: string(),
    features: object({
      safety: number(),
      success: number(),
      cost: number(),
      information_gain: number(),
    }, ['safety', 'success', 'cost', 'information_gain']),
    metadata: unknownObject(),
  }, ['id', 'type', 'features'])),
}, ['goal', 'world_state', 'candidates'])

const readMeta = {
  isReadOnly: true,
  isDestructive: false,
  isConcurrencySafe: true,
  isOpenWorld: false,
  replay: 'safe',
  costHint: undefined,
  deferLoading: false,
  requiresApproval: 'never',
}

const memoryWriteMeta = {
  isReadOnly: false,
  isDestructive: false,
  isConcurrencySafe: false,
  isOpenWorld: false,
  replay: 'never',
  costHint: undefined,
  deferLoading: false,
  requiresApproval: 'never',
}

const result = (structured) => ({
  content: [{ type: 'text', text: JSON.stringify(structured) }],
  structured,
})

export const embodiedRescuePlugin = {
  inject: ['extension'],
  apply(ctx) {
    const agnes = ctx.extension()
    const targetEvidence = createTargetEvidence()
    agnes.registerHook('tool_result', payload => { targetEvidence.observe(payload.name, payload.result); return {}; })
    const tools = createCognitiveBackendTools({
      missionId: 'agnes-embodied-rescue',
      goal: 'embodied rescue mission',
    })

    agnes.registerTool({
      name: 'mission_get_state',
      description: 'Read mission state for the current user-stated objective. Search only as much as needed to satisfy it; do not infer an exhaustive building survey. Reinspect detected objects below 0.80 while still nearby, record evidence in world_memory_update, and read mission state before the final report. A person observation is a demo personnel target, not verified researcher identity.',
      parameters: emptyInput,
      meta: readMeta,
      async execute() {
        return result(tools.mission_get_state())
      },
    })
    agnes.registerTool({
      name: 'mission_reset',
      description: 'Start a new mission by resetting mission-scoped in-memory state. Pass the new mission_id when the host starts a new mission; a reset without a new id is rejected after completion.',
      parameters: missionResetParameters,
      meta: memoryWriteMeta,
      async execute(input) {
        const reset = tools.mission_reset(input)
        if (reset.world_memory) targetEvidence.clear()
        return result(reset)
      },
    })
    agnes.registerTool({
      name: 'world_memory_get',
      description: 'Read structured World Memory.',
      parameters: emptyInput,
      meta: readMeta,
      async execute() {
        return result(tools.world_memory_get())
      },
    })
    agnes.registerTool({
      name: 'world_memory_update',
      description: 'Apply a structured World Memory update. current_plan must be an array of objects, e.g. [{action_id:"next",action_type:"navigate_to",target:"<observed location>"}], never strings. Mark target_status found only after genuine Agnes camera evidence >=0.80 and still_uncertain=false; action success alone does not confirm a person.',
      parameters: worldMemoryUpdateParameters,
      meta: memoryWriteMeta,
      async execute(input) {
        if (/^(?:found|secured)$/i.test(input.target_status ?? '') && !targetEvidence.confirmation()) {
          return {...result({status:'FAILED',code:'TARGET_NOT_CONFIRMED',still_uncertain:true,recovery:'Do not report confirmed personnel. Keep uncertain clues as located, choose another useful view or search another relevant area. Never repeat the same failed view indefinitely.'}),isError:true}
        }
        return result(tools.world_memory_update(input))
      },
    })
    agnes.registerTool({
      name: 'decision_score_candidates',
      description: 'Score candidate actions with the available provider.',
      parameters: decisionParameters,
      meta: readMeta,
      async execute(input) {
        return result(tools.decision_score_candidates(input))
      },
    })
  },
}

export const embodiedRescueSkills = {
  inject: ['skills'],
  apply(ctx) {
    ctx.skills.register({
      name: 'embodied-rescue',
      description: 'Use the structured method for embodied rescue missions.',
      body: [
        'Read MissionState and WorldMemory first. Discover locations and map from Robot MCP.',
        'Derive required work from the user task. Choose reachable rooms from observed topology only while needed to locate the requested target or gather evidence for a requested report. Do not expand a single-target search into an exhaustive room or door survey unless requested; report what remains uninspected.',
        'Traverse routes via registered intermediate waypoints when needed to reach the selected objective; do not impose a fixed room order.',
        'Current camera frames are analyzed by Agnes multimodal vision. A verified person observation identifies a demo rescue target, never a verified real-world identity.',
        'Do not repeat rooms already marked searched.',
        'Record navigation failures in blocked_routes and replan.',
        'After three identical low-level ABORTED/TIMEOUT/error_code=104 navigation failures, stop trying new locations. Inspect robot/world state, perform one real recovery, then report NAVIGATION_SYSTEM_UNHEALTHY if it still fails; never retry a broken navigation stack indefinitely.',
        'Each mission starts with fresh mission-scoped plan/action/search/route/target state. Historical observations are usable only with provenance, observed_at, and source, and must not be presented as current observations.',
        'Generate well-formed candidates and use DecisionProvider scoring when it helps choose among relevant next actions. Each candidate requires id, type, and numeric safety/success/cost/information_gain features in [0,1]. If scoring rejects malformed input, correct it once or choose an evidence-based action directly; do not retry unchanged.',
        'For every actual detection below confidence 0.80, use its detection id for inspect_object while still in its view region. Record active_perception:true for actual successful reinspection, including uncertain results. SUCCEEDED means the inspection executed; still_uncertain:true or target_verified:false means no target confirmation. If it remains uncertain, retain a suspected clue (located), choose another useful view or another relevant area, and do not mark found or end the search.',
      'Verify action results and update WorldMemory after every action: searched_room, known_object, detected_hazard, action, robot_location, last_observation, current_plan. On blocked failure record blocked_route; set replan:true when choosing an alternative.',
        'navigate_to may return status PENDING or action_status EXECUTING when a real Nav2 goal is still running. If it returns SUCCEEDED, use that terminal result directly without a redundant state read. For PENDING, do not issue another navigation or treat it as failure: call get_robot_state for the matching navigation_operation_id until navigation_terminal_known is true, then use the reported SUCCEEDED, ABORTED, CANCELED, or UNKNOWN terminal state. Never report navigation success from PENDING.',
        'get_world_state and get_observation each acquire a camera frame and run Agnes vision. Use get_robot_state for navigation and scan status polling. Reuse completed inspect_room evidence for the unchanged scan and available open_door verification.fresh_camera_observation when camera_after_motion is true; request new camera evidence after further motion or failed perception. Do not duplicate image inference just to verify a terminal action already supported by its structured evidence.',
        'Memory fields must follow the tool schema: current_plan is an array of objects with action_id/action_type/target; never use plain strings. After invalid arguments, correct the shape once; do not issue unchanged calls. Before finishing, read mission_get_state and world_memory_get one last time.',
        'Report confirmed personnel or target status, route blockage or hazards, and actively verified important objects when evidence exists. For a risk report, distinguish observed hazards from unobserved areas and do not claim a complete building survey unless requested.',
        'Do not call mission_reset after the target is found; reset only when starting a new mission.',
      ].join('\n'),
    })
  },
}

export { presets } from './src/sensor-image-preset.mjs'
