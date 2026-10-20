// Runs the browser port (docs/js/sim) under Node.js and prints its logs as JSON,
// for tests/test_web_parity.py.
//   node tests/web_parity.mjs ehcc <target> <steps> [material] [surface]
//   node tests/web_parity.mjs loop1d <k_I> <mode>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFields, defaultConfig, EHCCSimulation, LOG_KEYS, Surface } from '../docs/js/sim/ehcc.js';
import { Loop1D } from '../docs/js/sim/loop1d.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [kind, ...args] = process.argv.slice(2);

if (kind === 'ehcc') {
    const [target, steps, material, surfaceName] = args;
    const fields = decodeFields(JSON.parse(readFileSync(join(root, 'docs', 'data', 'fields.json'), 'utf8')));
    const cfg = defaultConfig();
    let mat = null;
    if (material && material !== 'none') {
        mat = { metal: fields.materials[material].metal,
            ratio: { lam: fields.metal.lam / fields.rubber.lam, kappa: fields.metal.kappa / fields.rubber.kappa } };
        cfg.thermal.lam = fields.rubber.lam; cfg.thermal.kappa = fields.rubber.kappa;
    }
    let surface = null;
    if (surfaceName === 'sole_3d') {
        const s = fields.surfaces.sole_3d;
        surface = new Surface(s.height, s.domain_size, null, 'sole_3d');
        cfg.domainSize = s.domain_size;
    } else if (surfaceName === 'bump') surface = Surface.bump(cfg.N, cfg.domainSize);
    const disturbances = [
        { center: [0.45, 0.65], sigma: 0.12, P: 600, tStart: 100, tEnd: 140, Tsource: 150 },
        { center: [0.45, 0.65], sigma: 0.12, P: -600, tStart: 200, tEnd: 260, Tsource: 20 },
    ];
    const sim = new EHCCSimulation(cfg, fields.targets[target].data, { material: mat, surface, disturbances });
    const log = Object.fromEntries(LOG_KEYS.map((k) => [k, []]));
    for (let i = 0; i < Number(steps); i++) {
        const row = sim.step();
        for (const k of LOG_KEYS) log[k].push(row[k]);
    }
    process.stdout.write(JSON.stringify({ log, T: Array.from(sim.domain.T) }));
} else if (kind === 'loop1d') {
    const [kI, mode] = args;
    const loop = new Loop1D();
    const out = { gStar: [0, 18, -18].map((A) => loop.equilibriumGate(loop.regimeDisturbance(A))) };
    const run = mode === 'continuous' ? loop.run(Number(kI), { continuous: true }) : loop.run(Number(kI));
    out.t = Array.from(run.t); out.gate = Array.from(run.gate); out.e_mean = Array.from(run.eMean);
    process.stdout.write(JSON.stringify(out));
}
