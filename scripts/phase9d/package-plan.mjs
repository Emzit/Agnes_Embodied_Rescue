import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const root = '/data-ssd/zhongchengkai/agnes';
const runtime = `${root}/runtime/ros2-jazzy`;
const records = await Promise.all((await readdir(`${runtime}/.pixi/envs/default/conda-meta`))
  .filter(f => f.endsWith('.json')).map(async f => JSON.parse(await readFile(`${runtime}/.pixi/envs/default/conda-meta/${f}`, 'utf8'))));
const byName = new Map(records.map(r => [r.name, r]));
const names = ['bt-navigator', 'controller', 'planner', 'behaviors', 'lifecycle-manager', 'map-server',
  'costmap-2d', 'core', 'util', 'msgs', 'behavior-tree', 'navfn-planner', 'regulated-pure-pursuit-controller'];
const candidates = [];
for (const component of names) {
  const name = `ros-jazzy-nav2-${component}`;
  const query = await promisify(execFile)(`${root}/tools/pixi/bin/pixi`, ['search', name, '-p', 'linux-64',
    '-c', 'https://prefix.dev/robostack-jazzy', '-c', 'https://prefix.dev/conda-forge', '--json'],
    { env: process.env, cwd: runtime, timeout: 60000, maxBuffer: 4000000 });
  const available = JSON.parse(query.stdout)['linux-64'];
  if (!available?.length) throw new Error('OFFICIAL_COMPONENT_UNAVAILABLE');
  const actual = byName.get(`ros2-nav2-${component}`) ?? byName.get(name);
  if (!actual) throw new Error('COMPONENT_NOT_INSTALLED');
  const seen = new Set();
  const visit = n => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const dep of byName.get(n)?.depends ?? []) visit(dep.split(/\s/)[0]);
  };
  visit(actual.name);
  const dependencies = [...seen];
  const rviz = dependencies.some(n => /rviz/.test(n));
  const slam = dependencies.some(n => /slam-toolbox/.test(n));
  const gazeboMeta = dependencies.some(n => /^(gazebo|gz-harmonic|ros2-ros-gz|ros-jazzy-ros-gz)$/.test(n));
  candidates.push({ candidate: name, available_name: available[0].name, available_version: available[0].version,
    actual_installed_name: actual.name, version: actual.version, url: actual.url,
    direct_dependencies: actual.depends, introduces_rviz: rviz, introduces_slam_toolbox: slam,
    introduces_new_gazebo_meta_package: gazeboMeta, allowed_to_install: !rviz && !slam && !gazeboMeta });
  console.log(`${actual.name} ${actual.version}: CHECKED`);
}
const forbidden = records.filter(r => /^(ros-jazzy|ros2)-(rviz2|nav2-rviz-plugins|slam-toolbox|desktop|navigation2|nav2-bringup)$/.test(r.name));
const disk = (await promisify(execFile)('/bin/df', ['-Pk', root])).stdout.trim().split('\n').at(-1).split(/\s+/);
const availableBytes = Number(disk[3]) * 1024;
const plan = { candidates, nav2_meta_packages_used: false, forbidden_installed: forbidden.map(r => r.name),
  available_disk_bytes: availableBytes, disk_above_180_gib: availableBytes > 180 * 1024**3,
  pixi_lock_sha256: createHash('sha256').update(await readFile(`${runtime}/pixi.lock`)).digest('hex'),
  existing_gazebo: records.filter(r => /^(gz-sim8|libgz-sim8|ros.*-ros-gz-(sim|bridge))$/.test(r.name))
    .map(r => ({name: r.name, version: r.version})),
  allowed_to_install: forbidden.length === 0 && availableBytes > 180 * 1024**3 && candidates.every(c => c.allowed_to_install) };
await writeFile(`${root}/artifacts/phase9d/package-plan.json`, JSON.stringify(plan, null, 2) + '\n');
if (!plan.allowed_to_install) process.exit(1);
