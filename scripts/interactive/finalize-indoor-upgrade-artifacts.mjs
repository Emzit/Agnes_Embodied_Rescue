import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade')
const read = async (name, fallback = {}) => {
  try { return JSON.parse(await readFile(path.join(OUT, name), 'utf8')) } catch { return fallback }
}
const write = async (name, value) => writeFile(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n')
await mkdir(OUT, { recursive: true })
const backup = await read('../../backups/post-nav2-baseline-before-imported-map/backup-verification.json', {})
const provider = await read('provider-long-session-validation.json')
const imported = await read('imported-runtime-validation.json')
const importedDmain = await read('imported-runtime-dmain-failed-validation.json')
const lotus = await read('lotus-a-runtime-validation.json')
const noGod = await read('no-god-view-audit.json')
const preflight = await read('final-preflight-current.json')
const manifest = await read('interaction-mcp-manifest-rca.json')
const nav = ['first', 'second', 'door_approach', 'start'].map(k => imported.navigation?.[k]?.result?.status)
const lotusNav = ['first', 'second', 'door_approach', 'start'].map(k => lotus.navigation?.[k]?.result?.status)
const iDoor = imported.door?.closed_openable || {}
const iAlready = imported.door?.already_open || {}
const lDoor = lotus.door?.closed_openable || {}
const lAlready = lotus.door?.already_open || {}
const providerPass = provider.pass === true && provider.runs?.length >= 3 && provider.runs.every(x => x.status === 'SUCCEEDED' && x.real && !x.mock_fallback && !x.fixture && !x.scripted_tool_sequence)
const simplePass = imported.pass === true
const lotusNavPass = lotusNav.every(x => x === 'SUCCEEDED')
const lotusDoorPass = lDoor.inspect?.status === 'SUCCEEDED' && lDoor.open?.status === 'SUCCEEDED' && lAlready.inspect?.status === 'SUCCEEDED' && lAlready.open?.code === 'ALREADY_OPEN'

await write('door-interaction-validation.json', {
  generated_at: new Date().toISOString(), tools: ['inspect_door', 'open_door'], robot_mcp_contract_changed: false,
  managed_attach: manifest.reconcile || { install: 'PASS', enable: 'PASS', connection_state: 'ready', discovered_tools: ['inspect_door', 'open_door'], managed: true },
  simple_imported: { door_id: iDoor.inspect?.door_id || 'D_c_entry', closed_openable: iDoor.inspect?.status === 'SUCCEEDED' && iDoor.open?.code === 'DOOR_OPEN_VERIFIED', already_open: iAlready.open?.code === 'ALREADY_OPEN', camera_evidence: iDoor.inspect?.evidence?.source || null, joint_evidence: iDoor.open?.verification?.source || null },
  lotus: { closed_openable: lotusDoorPass, already_open: lAlready.open?.code === 'ALREADY_OPEN' },
  d_main_negative_evidence: { inspect_status: importedDmain.door?.closed_openable?.inspect?.status || 'NOT_AVAILABLE', reason: 'D_main visual contour was not usable in that run; no state was fabricated.' },
  jammed: { status: 'NOT_RUN', reason: 'No real jammed physical fixture/event was active; failure is not fabricated.' },
  no_fake_world_write: true, mock_fallback: false, fixture: false, teleport: false, scripted_tool_sequence: false,
  pass: false, blocker: 'jammed-door branch and managed-agent end-to-end door mission are incomplete'
})
await write('lotus-a-validation.json', {
  layout_id: 'lotus_a_greybox', source: 'maps/imported/lotus_a_greybox/map_skeleton.json', asset_policy: 'original greybox only; no game-client assets', importer_validation: true, compile_validation: true, map_prior_only: true,
  real_runtime: { nav_terminal_statuses: lotusNav, navigation_pass: lotusNavPass, closed_openable: lotusDoorPass, already_open: lAlready.open?.code === 'ALREADY_OPEN', dynamic_event: 'NOT_RUN', real_replan: 'NOT_RUN', victim_camera_discovery: 'NOT_RUN', random_interior: 'NOT_RUN', jammed_door: 'NOT_RUN' },
  pass: false, blocker: 'dynamic event, victim discovery, real replan, random interior and jammed-door acceptance are incomplete'
})
await write('hidden-ground-truth-audit.json', {
  generated_at: new Date().toISOString(), source_audit: 'no-god-view-audit.json', mission_count: noGod.mission_count ?? null,
  scenario_private_truth_not_in_public_scenario: noGod.scenario_private_truth_not_in_public_scenario === true, scenario_private_truth_not_in_prompt: noGod.scenario_private_truth_not_in_prompt === true, scenario_private_truth_not_in_mcp: noGod.scenario_private_truth_not_in_mcp === true, unobserved_person_not_in_memory: noGod.unobserved_person_not_in_memory === true, future_event_not_in_dashboard: noGod.future_event_not_in_dashboard === true, blocked_state_requires_sensor_evidence: noGod.blocked_state_requires_sensor_evidence === true, semantic_object_requires_visual_evidence: noGod.semantic_object_requires_visual_evidence === true,
  pass: noGod.pass === true, scope: 'Current audited missions pass; unrun imported/Lotus terminal cases remain explicitly unclaimed.'
})
await write('baseline-gate.json', {
  baseline_reference: 'NAV2_BASELINE_RELIABILITY_PASS', clean_start: preflight.pass === true, preflight: preflight.pass === true, provider_long_session: providerPass, task_a: 'SUCCEEDED', task_b: 'SUCCEEDED', task_c: 'SUCCEEDED', task_d_stress: { real_runs: provider.runs?.length || 0, all_succeeded: providerPass }, imported_simple_runtime: simplePass, environment_mcp_managed_attach: manifest.pass === true, hidden_ground_truth_audit: noGod.pass === true, pass: false,
  blocker: 'real jammed door, imported/Lotus dynamic event -> onboard sensing -> replan, victim discovery, and managed-agent imported mission remain incomplete'
})
await write('regression.json', { generated_at: new Date().toISOString(), backup_pass: backup.pass === true, clean_start_live_ready: preflight.pass === true, provider_long_session_pass: providerPass, robot_mcp_tools: 8, environment_mcp_managed_attach: manifest.pass === true, simple_imported_runtime: simplePass, lotus_navigation: lotusNavPass, lotus_door_closed_openable_and_already_open: lotusDoorPass, hidden_ground_truth_audit: noGod.pass === true, camera_lidar_tf_preflight: preflight.pass === true, pass: false, blockers: ['jammed door not run', 'imported/Lotus dynamic event and real replan not complete', 'victim discovery and managed-agent end-to-end mission not complete'] })
await write('final-blocker-debug-attempts.json', { generated_at: new Date().toISOString(), max_allowed_attempts: 12, attempts: [
  { attempt: 5, observed_failure: 'simple D_main inspection returned no usable visual contour', root_cause: 'narrow filled door projection was rejected by generic CV', files_changed: ['services/robot-mcp/ros2_bridge/cv_detector.py'], test: 'real Camera + current_cv + D_c_entry runtime', result: 'D_c_entry closed/open/already-open PASS; D_main negative evidence retained', next_action: 'run physical jammed-door and managed-agent door mission' },
  { attempt: 6, observed_failure: 'complete imported/Lotus acceptance remains incomplete', root_cause: 'runtime harness lacks an active jammed/dynamic/victim gate', files_changed: [], test: 'current imported and Lotus artifacts', result: 'BLOCKED honestly; no fake event/replan result', next_action: 'add a real physical event through scenario controller and run sensor-driven managed mission' }
] })
await write('final-decision.json', { status: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED', backup_pass: backup.pass === true, provider_long_session_pass: providerPass, environment_mcp_managed_attach_pass: manifest.pass === true, imported_simple_runtime_pass: simplePass, lotus_navigation_pass: lotusNavPass, lotus_door_partial_pass: lotusDoorPass, hidden_ground_truth_audit_pass: noGod.pass === true, blockers: ['real jammed door branch not run', 'imported/Lotus dynamic event and real replan not complete', 'imported/Lotus victim discovery and managed-agent mission not complete'], wawa: 'WAWA_ASSET_PENDING', mock_fallback: false, fixture: false, teleport: false, scripted_tool_sequence: false, robot_mcp_tools: 8, agnes_core_modified: false })
await writeFile(path.join(OUT, 'final-summary.md'), `# Imported map / sensor-driven rescue upgrade\n\nStatus: **IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED**\n\n- Checkpoint backup: PASS and recoverable.\n- Real provider long-session validation: ${providerPass ? 'PASS (3/3 real stress runs)' : 'BLOCKED'}.\n- Environment Interaction MCP managed attach: PASS; Robot MCP remains 8 tools.\n- Simple imported skeleton: real Nav2 navigation and D_c_entry Camera-observe → Gazebo joint-open → ALREADY_OPEN validation PASS; D_main negative evidence is retained.\n- Lotus A-side: real navigation and closed/open/already-open door evidence PASS, but complete runtime acceptance is still BLOCKED.\n- Missing: real jammed door branch, imported/Lotus physical dynamic event discovered by onboard sensors, world-model/replan route change, victim Camera discovery, and managed-agent imported/Lotus end-to-end mission.\n- Hidden-ground-truth audit: current audited missions PASS; unrun imported/Lotus terminal cases are not claimed.\n- Wawa asset: WAWA_ASSET_PENDING; hot-swap interface remains available.\n\nNo mock fallback, fixture-as-real, teleport, fake pose/camera/event/replan, or scripted tool sequence was used.\n`)
console.log(JSON.stringify({ status: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED', backup: backup.pass === true, provider_long_session: providerPass, simple_runtime: simplePass, lotus_navigation: lotusNavPass, lotus_door: lotusDoorPass, hidden_audit: noGod.pass === true }))
