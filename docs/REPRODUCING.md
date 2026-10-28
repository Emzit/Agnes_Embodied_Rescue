# Reproducing Agnes Embodied Rescue

English | [简体中文](REPRODUCING.zh-CN.md)

[Project overview](../README.md) · [Architecture](../README.md#architecture) · [Integration standards](../README.md#integration-standards)

This guide separates offline source checks from live simulation. They have different requirements and acceptance criteria.

| Path | Requirements | What it verifies |
| --- | --- | --- |
| Offline checks | Node.js 24.10+; Python 3.12 is the tested Python version | Selected logic and interface boundaries, without model calls or robot motion |
| Live simulation | Linux, authorized Agnes provider, ROS2/Nav2/Gazebo and configured local runtime | Current camera/pose evidence and native sessions connected to real simulation tools |

The live chain has been exercised on the demonstration server. A complete installation on a fresh machine has not been independently validated. Installed toolchains, private configuration, the office AMCL overlay and generated native binaries are not bundled.

## 1. Clone and run offline checks

```bash
git clone https://github.com/Emzit/Agnes_Embodied_Rescue.git
cd Agnes_Embodied_Rescue

node --version
python3 --version

node --test \
  services/robot-mcp/tests/navigation-lifecycle.test.ts \
  services/robot-mcp/tests/perception-output.test.ts \
  services/robot-mcp/tests/vlm-turn.test.ts \
  packages/embodied-rescue-plugin/tests/runtime-entry.test.ts

python3 -B -m unittest discover \
  -s services/robot-mcp/tests -p 'test_doorway_navigation.py'
```

Expected selected-suite results: 19 Node tests and 6 Python tests. These tests use test doubles and do not establish a live-task success rate. The root `pnpm test` selects a different, broader set of files and is not an equivalent replacement.

Harness source is included directly in `third_party/agnes-harness`; no Git submodule initialization is required.

## 2. Review deployment paths and prerequisites

| Component | Demonstrated configuration |
| --- | --- |
| OS | Ubuntu / Linux x86_64; the Pixi workspace targets `linux-64` |
| Node.js / pnpm | 24.10.0 / 10.34.5 |
| Pixi | 0.81.0 |
| Robot software | ROS2 Jazzy, Nav2, Gazebo Sim 8 |
| Model | Authorized `agnes-ai` provider with `agnes-3.0-flash` for task and image sessions |
| Isolation | `ROS_DOMAIN_ID=106`, `GZ_PARTITION=agnes_final_rescue` in the default project stack |

Some scripts still embed the original absolute workspace path. Review and port these paths before live startup; setting a single root environment variable does not rewrite them. Locate the bindings with:

```bash
git grep -nE '/data-ssd/[^/]+/agnes' -- \
  scripts services demo packages simulation runtime
```

Offline checks above can run from an ordinary clone. The full stack and map importer have stricter path dependencies. Windows browsers can access the Linux deployment; running the complete stack natively on Windows is outside the validated scope.

## 3. Install the toolchain and dependencies

Obtain [Node.js 24.10](https://nodejs.org/dist/v24.10.0/) and [Pixi 0.81.0](https://github.com/prefix-dev/pixi/releases/tag/v0.81.0) from their official releases and verify their checksums. Prepare `pnpm@10.34.5`. Project launchers expect this local layout:

```text
tools/
├── node/bin/node
├── node/bin/pnpm
└── pixi/bin/pixi
```

From the repository root, after preparing those executables:

```bash
source scripts/use-local-toolchain.sh

pnpm --dir third_party/agnes-harness install --frozen-lockfile
pnpm --dir services/robot-mcp install --frozen-lockfile

tools/pixi/bin/pixi install --locked \
  --manifest-path runtime/ros2-jazzy/pixi.toml

pnpm --dir third_party/agnes-harness --filter @agnes/cli build:local
```

See the vendored [Harness installation guide](../third_party/agnes-harness/docs/guide/install.md) for native build requirements. Environment MCP reuses dependencies under `services/robot-mcp/node_modules`.

Additional office-scene requirements:

- **AMCL overlay:** the runtime expects `runtime/ros2-jazzy/overlays/amcl/lib/nav2_amcl/amcl`. Prepare a Jazzy-compatible build; this local overlay is not part of the current Pixi manifest. See [stack.py](../scripts/phase9d/stack.py) and [office-localization.mjs](../scripts/interactive/office-localization.mjs).
- **Native fire renderer:** review the [build requirements](../simulation/visual_assets/volumetric_fire/README.md), then build with `python3 -B simulation/visual_assets/volumetric_fire/build.py`. Gazebo/Ogre development dependencies and shader-validation tooling are required separately.
- **Rendering and sensors:** validate the host's Gazebo/Ogre camera rendering, image encoding and model connectivity. Installing Pixi alone does not validate these paths.

## 4. Configure Agnes, the plugin and MCP

Use the vendored [quickstart](../third_party/agnes-harness/docs/guide/quickstart.md) to configure your own model authorization. The project runtime uses `AGH_HOME=<project-root>/.agh-home-step7` and Profile `local-dev`. The image adapter requires provider `agnes-ai` and model `agnes-3.0-flash`.

Never commit API keys, account Profiles, daemon authentication files or session databases. Do not copy another installation's private runtime directory.

Install, trust and enable `file:./packages/embodied-rescue-plugin` through the Harness package workflow. It registers backend tools, the rescue Skill and image-session presets. Configure the two managed MCP services through the supported [MCP configuration interfaces](../third_party/agnes-harness/docs/guide/mcp.md):

| Field | Robot MCP | Environment MCP |
| --- | --- | --- |
| `serverId` | `robot-mcp` | `envdoor` |
| `transport.kind` | `stdio` | `stdio` |
| `transport.executable` | `<project-root>/tools/node/bin/node` | `<project-root>/tools/node/bin/node` |
| `transport.args` entry | `<project-root>/scripts/final-rescue/mcp-launch.mjs` | `<project-root>/scripts/final-rescue/environment-interaction-launch.mjs` |
| `secretBinding` | `{"kind":"none"}` | `{"kind":"none"}` |

Replace `<project-root>` with the reviewed absolute path. The services inherit the project-isolated runtime; the model provider still needs its own authorization even though the MCP services have no separate secret binding.

Verify that the plugin is trusted/running, both servers are ready, and Robot MCP exposes the eight documented tools. Tool names alone do not prove a live ROS backend: check the real launchers and `ROBOT_GATEWAY=ros2`. The historical `scripts/step7-prepare.mts` registers mock robot tools and must not be used as the live setup.

## 5. Start a configured live environment

Check for active tasks, navigation goals and motion leases first. Reuse known project services where possible; do not stop unrelated processes merely because a port is occupied.

Start native Web in one terminal from the project root:

```bash
bash scripts/start-step7-agnes.sh
```

For a configured cold start, use a second terminal:

```bash
bash scripts/interactive/start.sh
```

This second entry point starts/reuses the simulation, enables/configures managed resources, runs real provider/tool probes, starts the camera adapter and updates local state. It is not a UI-only command and needs model/network access. Its legacy readiness probe references `D_A_Link`; if that door does not exist in the active map, diagnose the mismatch instead of concluding that every door is unavailable or repeatedly rerunning startup.

The separate `bash scripts/final-rescue/start-stack.sh` only starts the robot stack; it does not establish that the model, native Session or camera presentation is ready.

To start/reuse the demonstration UI and read-only monitoring:

```bash
python3 scripts/demo-ui-final/start.py
```

This UI entry does not reset the simulation, initialize model credentials or issue navigation. Visit **http://127.0.0.1:4177/demo**.

For remote access, substitute your own SSH account and host:

```bash
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:4177:127.0.0.1:4177 YOUR_USER@YOUR_SERVER
```

Current code proxies native WebSocket traffic through `/agh-rpc`, so forwarding 4177 normally suffices. Older deployments may need their actual daemon WebSocket port forwarded separately. Do not expose unauthenticated robot or model services publicly.

## 6. Verify readiness and submit a task

Read the local state endpoint:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:4177/api/demo-ui/state
```

Check native Session association, fresh ROS/TF pose and camera frames, idle navigation, no active goal and an available motion lease. The response includes local runtime identifiers; review/redact it before sharing.

Start with “Where is the robot now?” and compare the actual `get_robot_state` result with the map. Then submit “Please find a person who needs rescue.” If acceptance also requires opening a door, entering, approaching, reinspecting and stopping, state those requirements and preserve any follow-up instructions.

Judge success from relevant terminal tool results, pose, current images and stop state. A finished model turn or component `READY` is not proof that every physical subgoal completed.

## 7. Import and switch layouts

Use the [office skeleton](../maps/imported/office_fire/office_skeleton.json) as a format example. Upload, name and preview a JSON skeleton before explicitly confirming physical switching. Switching requires idle-task/navigation and motion-lock checks; afterward verify the new map, pose, camera and Session association.

Within the already-ported project workspace, geometry can be checked without starting Gazebo:

```bash
python3 -B scripts/map-import/map_import.py validate \
  maps/imported/office_fire/office_skeleton.json
```

The importer still enforces a configured workspace boundary. This command is not part of the arbitrary-clone offline test suite in section 1. Spatial priors and initial door conditions do not establish current door state or reveal current personnel evidence.

## 8. Troubleshooting and reporting

| Symptom | Check first |
| --- | --- |
| Page loads but native Chat does not respond | Provider configuration, Session connectivity and `/agh-rpc` handshake; for old deployments, the actual daemon port |
| Chat works but robot tools are missing | `local-dev` Profile, enabled rescue plugin, correct live MCP launchers |
| Camera is black or stale | Frame timestamps and `/api/demo-ui/camera.jpg`; distinguish display failures from acquisition/inference failures |
| Office localization fails | AMCL overlay, active map parameters and `map` / `odom` / `base_link` transforms |
| Scene switch is rejected | Active goals, motion lease, pending native approvals and observer freshness |
| Navigation times out or a mission is partial | Actual Nav2 terminal state and operation ownership; do not submit duplicate goals or infer arrival from timeout |
| Historical media/submission pages are unavailable | They require local artifacts; use the [public demo](https://www.bilibili.com/video/BV1F1J66YEkB/) |

For an issue, record the commit, environment versions, map, reproduction steps and whether the test was offline or live. Remove credentials, private session data, contact information and unreviewed traces before sharing. Keep ROS/Gazebo isolation and restrict recovery actions to verified project-owned processes.
