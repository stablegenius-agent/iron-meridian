// Operation planning (eligibility, ETA, odds) and execution/resolution.
import * as THREE from 'three';
import { OPS, SITE_TYPES, UNIT_TYPES } from './data.js';
import { GLOBE_R, distanceKm, llToVec3 } from './geo.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (x) => Math.round(clamp(x, 0, 1) * 100);

const CODE_A = ['IRON', 'CRIMSON', 'SILENT', 'BLACK', 'NORTHERN', 'BURNING', 'GLASS', 'THUNDER', 'COBALT', 'SHATTERED', 'MIDNIGHT', 'SOVEREIGN',
  'ARCTIC', 'SCARLET', 'HOLLOW', 'TITAN', 'FALLING', 'SILVER', 'DESERT', 'OBSIDIAN', 'RESOLUTE', 'PHANTOM', 'GOLDEN', 'STEEL'];
const CODE_B = ['TRIDENT', 'TEMPEST', 'ANVIL', 'SPEAR', 'LANTERN', 'HAMMER', 'VIGIL', 'SERPENT', 'FALCON', 'MERIDIAN', 'RAMPART', 'COMPASS',
  'HARVEST', 'GAUNTLET', 'ECLIPSE', 'BASTION', 'NEEDLE', 'CROWN', 'HORIZON', 'FURY', 'MONSOON', 'SABRE', 'ORACLE', 'WARDEN'];
function codename(rng) { return `${CODE_A[Math.floor(rng() * CODE_A.length)]} ${CODE_B[Math.floor(rng() * CODE_B.length)]}`; }

/** Which ops make sense for a country (and why some don't). */
export function availableOps(game, c) {
  const list = [];
  const home = c.stance === 'home';
  for (const [key, op] of Object.entries(OPS)) {
    if (home && key !== 'patrol') continue;
    if (op.coastal && !c.coastal) continue;
    if (key === 'aid' && (c.stance === 'hostile' || c.stance === 'rival')) continue;
    if (key === 'invade' && c.stance === 'controlled') continue;
    list.push(key);
  }
  return list;
}

/** Units able to perform `opKey` (on `site` if given), sorted by ETA. */
export function eligibleUnits(game, opKey, c, site) {
  const op = OPS[opKey];
  const target = site ? site.ll : c.ll;
  const out = [];
  for (const u of game.units) {
    let uses = op.uses;
    if (opKey === 'strike' && site && SITE_TYPES[site.type].cyberOnly) uses = ['cyber'];
    if (opKey === 'strike' && site && SITE_TYPES[site.type].raidOnly) uses = [];
    if (opKey === 'raid' && site && SITE_TYPES[site.type].cyberOnly) uses = [];
    if (!uses.includes(u.type) || u.state === 'lost') continue;
    const ready = u.available;
    let eta = u.etaTo(target);
    // Naval strikes fire from range; naval presence ops must sail to the coast.
    if (u.cls === 'naval') {
      const dist = distanceKm(u.ll, target);
      const needSail = ['patrol', 'blockade'].includes(opKey) || ((opKey === 'strike' || opKey === 'campaign' || opKey === 'recon') && dist > (u.t.range || 0));
      if (needSail) {
        const st = c.station;
        if (!st) continue;
        eta = distanceKm(u.ll, st) / u.t.speed * 1.25;
      } else eta = 0.5 + dist / 880; // cruise missile flight time
    }
    if (u.cls === 'ground' && u.state === 'onstation' && u.task?.ci === c.i) continue;
    out.push({ u, eta, ready, why: ready ? '' : u.statusText() });
  }
  out.sort((a, b) => (b.ready - a.ready) || a.eta - b.eta);
  return out;
}

/** Estimate outcome for the UI. */
export function estimate(game, opKey, c, site, units) {
  const op = OPS[opKey];
  const diff = game.difficulty;
  const intel = c.intel;
  const res = { success: 0, loss: 0, collateral: 0, tension: 0, cost: 0, notes: [] };
  if (!units.length) return res;
  res.cost = game.sandbox ? 0 : units.reduce((a, u) => a + u.t.cost, 0) * 2.5 * (opKey === 'campaign' ? 3 : opKey === 'invade' ? 2 : 1);

  const ad = c.ad / 100, air = c.air / 100;
  const fighters = units.filter(u => u.type === 'fighter' || u.type === 'carrier').length;
  const escort = fighters ? 0.45 : 1;
  const airUnits = units.filter(u => u.cls === 'air');
  const lossFor = (u) => (ad * 0.38 + air * 0.22 * escort) * (1 - (u.t.stealth || 0)) * diff;
  const anyLoss = 1 - airUnits.reduce((p, u) => p * (1 - lossFor(u)), 1);
  res.loss = ['strike', 'campaign', 'raid', 'patrol', 'recon'].includes(opKey) && (c.stance === 'hostile' || c.stance === 'rival') ? anyLoss : 0.02 * airUnits.length;

  const accuracy = 0.55 + intel / 220;
  if (opKey === 'strike' && site) {
    const t = SITE_TYPES[site.type];
    let dmg = 0;
    for (const u of units) {
      const s = u.cls === 'cyber' ? (u.t.cyber || 0) * 1.4 : (u.t.strike || 0);
      const survive = u.cls === 'air' ? 1 - lossFor(u) : u.cls === 'naval' ? 1 - ad * 0.35 : 1;
      dmg += s * 13 * (1 - t.hard * 0.45) * accuracy * survive;
    }
    res.success = clamp(dmg / site.hp * 0.85, 0.04, 0.98);
    const col = units.reduce((a, u) => a + ({ bomber: 3, orbital: 5, fighter: 1.4, drone: 0.5, carrier: 1.6, destroyer: 1.4, submarine: 1.3, cyber: 0 }[u.type] ?? 1), 0);
    res.collateral = col * (1.25 - intel / 100) * (site.type === 'hq' ? 1.5 : 1);
    if (site.type === 'hostage') res.notes.push('Strikes on the compound will kill the hostages.');
  } else if (opKey === 'raid' && site) {
    const raid = units.reduce((a, u) => a + (u.t.raid || 0), 0);
    res.success = clamp(0.4 + raid * 0.035 + intel / 260 - ad * 0.18, 0.1, 0.97);
    res.collateral = 0.2;
    res.loss = clamp((1 - res.success) * 0.5 * diff, 0.02, 0.6);
  } else if (opKey === 'recon') {
    res.success = 0.97;
    res.notes.push(`Intel +${units.reduce((a, u) => a + (u.t.recon || 15), 0)}`);
  } else if (opKey === 'cyber_ad' || opKey === 'cyber_grid') {
    const cy = units.reduce((a, u) => a + (u.t.cyber || 0), 0);
    res.success = clamp(0.35 + cy * 0.06 + intel / 300 - c.mil / 260, 0.1, 0.96);
  } else if (opKey === 'campaign') {
    const s = units.reduce((a, u) => a + (u.t.strike || 0), 0);
    res.success = clamp(0.25 + s * 0.035 + intel / 250 - ad * 0.3, 0.1, 0.95);
    res.collateral = units.length * 2.2 * (1.3 - intel / 100);
  } else if (opKey === 'invade') {
    const g = units.reduce((a, u) => a + (u.t.ground || 0), 0) + game.supportPower(c);
    const def = c.mil * 0.55 + (c.stance === 'rival' ? 30 : 0);
    res.success = clamp(0.2 + (g * 3.2 - def) / 110, 0.03, 0.95);
    res.loss = clamp(def / (g * 6 + 20) * 0.6 * diff, 0.05, 0.85);
    res.collateral = 4 + c.pop / 2.5e7;
  } else {
    res.success = 0.95;
  }

  // Escalation
  const esc = op.esc;
  let tension = { '-1': -5, 0: 0, 1: 1.5, 2: 4, 3: 8, 4: 13 }[esc];
  if (c.stance === 'rival') tension *= 2.5;
  if (c.stance === 'neutral' && esc >= 2) tension *= 1.6;
  if (c.stance === 'ally' && esc >= 2) tension *= 2.2;
  if (c.stance === 'controlled' && esc >= 2) tension *= 0.5;
  if (site && site.faction) tension *= 0.35; // hitting terrorists, not states
  if (opKey === 'patrol' && (c.stance === 'ally' || c.stance === 'home' || c.stance === 'controlled')) tension = 0;
  res.tension = Math.round(tension);
  res.successPct = pct(res.success);
  res.lossPct = pct(res.loss);
  res.collLabel = res.collateral < 1 ? 'MIN' : res.collateral < 3 ? 'LOW' : res.collateral < 6 ? 'MED' : 'HIGH';
  if (c.stance === 'ally' && esc >= 2) res.notes.push('Attacking an ally will shatter the alliance.');
  if (c.stance === 'rival' && esc >= 2) res.notes.push('Striking a rival power risks global war.');
  if (c.stance === 'neutral' && esc >= 2 && !(site && site.faction)) res.notes.push('This will turn them hostile.');
  return res;
}

// ====================================================================== execution
export function execute(game, opKey, c, site, units) {
  const est = estimate(game, opKey, c, site, units);
  if (!game.sandbox && game.budget < est.cost) { game.toast('Insufficient budget', 'bad'); return false; }
  game.budget -= est.cost;
  const op = OPS[opKey];
  const opId = game.nextOpId++;
  game.audio.confirm();

  // Diplomatic fallout is immediate: the world sees you launch.
  if (op.esc >= 2 && !(site && site.faction && c.stance !== 'ally')) {
    if (c.stance === 'neutral' || c.stance === 'ally') {
      if (c.stance === 'ally') { game.approval -= 6; game.feed(`${c.name} severs the alliance after US aggression.`, 'bad'); }
      game.world.setStance(c, 'hostile', true);
      c.aggression = 40;
      game.ui.refreshLabels();
    }
  }
  if (op.esc >= 2) { c.relation -= 15 * op.esc; c.aggression = clamp(c.aggression + 10 * op.esc, 0, 100); c.struck = (c.struck || 0) + 1; }
  game.addTension(est.tension);
  game.log.ops++;

  const names = units.map(u => u.name).join(', ');
  const code = op.esc >= 2 || opKey === 'aid' ? codename(game.rng) : null;
  game.feed(`${code ? `OPERATION ${code} — ` : ''}${op.name.toUpperCase()} → ${site ? site.name + ', ' : ''}${c.name}: ${names}`, 'info');
  if (code) game.ui.alert(`OPERATION ${code}`, `${op.name} · ${c.name}`, opKey === 'aid' ? 'good' : 'info');

  for (const u of units) {
    u.task = { op: opKey, ci: c.i, siteId: site?.id, opId, est };
    u.sorties++;
    dispatch(game, u, opKey, c, site, est);
  }
  if (units.some(u => u.cls === 'air' || u.cls === 'ground')) game.audio.launchJet();
  game.ui.dirtyForces = true;
  return true;
}

function dispatch(game, u, opKey, c, site, est) {
  const target = site ? site.ll : c.ll;
  const tgtPoint = (opKey === 'patrol' || opKey === 'campaign' || opKey === 'invade' || opKey === 'aid') ? game.world.pointIn(c, 0.4) : target;

  if (u.cls === 'cyber') {
    u.state = 'rearming';
    u.readyAt = game.time + u.t.rearm * (game.sandbox ? 0.3 : 1);
    game.audio.cyber();
    game.fx.stream(llToVec3(u.base.ll[0], u.base.ll[1]), llToVec3(target[0], target[1], GLOBE_R * 1.003), 0x3dffc5, 4);
    game.after(1.5, () => resolve(game, u, opKey, c, site, est, target));
    return;
  }

  if (u.cls === 'space') {
    u.state = 'rearming';
    u.readyAt = game.time + u.t.rearm * (game.sandbox ? 0.25 : 1);
    u.hoverOver(target, u.type === 'satellite' ? 30 : 3);
    if (u.type === 'satellite') {
      game.audio.scan();
      game.after(1.2, () => {
        game.fx.scanCone(u.worldPos(), llToVec3(target[0], target[1], GLOBE_R), 0x66e0ff, 4);
        resolve(game, u, opKey, c, site, est, target);
      });
    } else {
      // orbital rod: descend after the platform swings overhead
      game.after(2.2, () => {
        const top = u.worldPos();
        const g = llToVec3(target[0], target[1], GLOBE_R * 1.001);
        game.audio.rod();
        game.fx.projectile(top, g, { peak: 0, duration: 1.1, color: 0xfff2c0, width: 1.6, onHit: () => resolve(game, u, opKey, c, site, est, target) });
      });
    }
    return;
  }

  if (u.cls === 'naval') {
    const st = c.station;
    const inRange = distanceKm(u.ll, target) <= (u.t.range || 0);
    const presence = opKey === 'patrol' || opKey === 'blockade';
    if (presence || !inRange) {
      if (!st) { game.toast(`${u.name}: no sea access`, 'bad'); u.task = null; return; }
      u.sailTo(st, () => {
        u.state = 'onstation';
        u.stationCi = c.i;
        if (presence) { arriveOnStation(game, u, opKey, c); }
        else fireCruise(game, u, opKey, c, site, est, target);
        game.ui.dirtyForces = true;
      });
    } else {
      fireCruise(game, u, opKey, c, site, est, target);
    }
    return;
  }

  // air & ground-by-airlift
  u.flyTo(tgtPoint, () => {
    if (u.cls === 'ground' && (opKey === 'invade' || opKey === 'patrol')) {
      u.state = 'onstation';
      u.obj.visible = false;
      if (u.trail) u.trail.geometry.setDrawRange(0, 0);
      u.deployGround(c);
      if (opKey === 'invade') game.startInvasion(c, u);
      else game.feed(`${u.name} deployed to defend ${c.name}.`, 'info');
    } else if (opKey === 'patrol' || opKey === 'campaign' || (opKey === 'recon' && u.type === 'drone')) {
      u.state = 'onstation';
      u.loiterUntil = game.time + (opKey === 'campaign' ? 72 : opKey === 'recon' ? 10 : 30);
      u.nextSortie = game.time + 0.5;
      u.orbitCenter = tgtPoint;
      if (opKey === 'recon') resolve(game, u, opKey, c, site, est, tgtPoint);
    } else if (opKey === 'aid') {
      resolve(game, u, opKey, c, site, est, tgtPoint);
      u.returnHome();
    } else {
      resolve(game, u, opKey, c, site, est, tgtPoint);
      u.returnHome();
    }
    game.ui.dirtyForces = true;
  });
  if (u.cls === 'ground' && opKey === 'patrol') u.task.op = 'patrol';
}

function arriveOnStation(game, u, opKey, c) {
  if (opKey === 'blockade') {
    c.blockaded = true;
    game.world.recompute(c, game.time);
    game.feed(`${u.name} has ${c.name} under blockade.`, 'warn');
  } else {
    game.feed(`${u.name} on station off ${c.name}.`, 'info');
  }
}

function fireCruise(game, u, opKey, c, site, est, target) {
  u.state = u.cls === 'naval' && u.stationCi >= 0 ? 'onstation' : 'ready';
  const n = u.type === 'carrier' ? 2 : 3;
  const from = u.worldPos();
  const to = llToVec3(target[0], target[1], GLOBE_R * 1.002);
  game.audio.launchMissile();
  for (let i = 0; i < n; i++) {
    game.after(i * 0.25, () => {
      const m = game.models.create('missile', 'us', 0.012);
      game.fx.projectile(from, to, { peak: 0.05, duration: 2.2, color: 0xffd090, model: m, onHit: () => { if (i === n - 1) resolve(game, u, opKey, c, site, est, target); else game.fx.explosion(to, 0.8); } });
    });
  }
  if (opKey === 'recon') { u.task = null; return; }
  u.task = null;
  game.ui.dirtyForces = true;
}

/** Apply the result of one unit's action at the target. */
export function resolve(game, u, opKey, c, site, est, at) {
  const rng = game.rng;
  const pos = llToVec3(at[0], at[1], GLOBE_R * 1.002);
  const hostileAir = c.stance === 'hostile' || c.stance === 'rival';

  // Air losses: SAMs and interceptors get a shot at every aircraft over hostile territory.
  if (u.cls === 'air' && hostileAir && ['strike', 'raid', 'campaign', 'recon'].includes(opKey)) {
    const ad = c.ad / 100, air = c.air / 100;
    const escort = game.units.some(f => f.type === 'fighter' && f.task?.ci === c.i && f.state === 'onstation') ? 0.45 : 1;
    const p = (ad * 0.38 + air * 0.22 * escort) * (1 - (u.t.stealth || 0)) * game.difficulty * (opKey === 'recon' ? 0.4 : 1);
    const shotDown = rng() < p;
    airDefenseShow(game, c, u, shotDown);
    if (shotDown) {
      // The kill lands when the SAM/interceptor arrives; the strike is lost with the aircraft.
      game.after(1.3, () => game.unitLost(u, `shot down over ${c.name}`));
      return;
    }
  }

  switch (opKey) {
    case 'recon': {
      const gain = u.t.recon || 15;
      const before = game.world.sites.filter(s => s.ci === c.i && game.world.visible(s)).length;
      c.intel = clamp(c.intel + gain, 0, 100);
      const after = game.world.sites.filter(s => s.ci === c.i && game.world.visible(s)).length;
      game.fx.popup(pos, `INTEL +${gain}`, 'ally');
      if (after > before) { game.feed(`Recon over ${c.name} revealed ${after - before} new target${after - before > 1 ? 's' : ''}.`, 'good'); game.audio.success(); }
      game.ui.refreshSites();
      break;
    }
    case 'aid': {
      game.addTension(-6);
      game.approval += 3;
      c.relation += 25;
      c.stability = clamp(c.stability + 15, 0, 100);
      game.score += 25;
      game.fx.popup(pos, 'AID DELIVERED', 'controlled');
      game.log.aid++;
      game.medal('hearts');
      game.fx.sprite(pos, 0x4dffa6, 0.04, 1.5);
      game.resolveCrisisWhere(cr => cr.type === 'disaster' && cr.ci === c.i, 'Aid delivered');
      if (c.stance === 'neutral' && c.relation > 50 && rng() < 0.5) { game.world.setStance(c, 'ally', true); game.feed(`${c.name} joins the coalition, grateful for US aid.`, 'good'); game.ui.refreshLabels(); }
      break;
    }
    case 'cyber_ad': {
      if (rng() < est.success) { c.adDownUntil = game.time + 24; game.world.recompute(c, game.time); game.fx.popup(pos, 'AIR DEFENSE BLIND', 'controlled'); game.feed(`${c.name} air defenses offline for 24h.`, 'good'); }
      else { game.fx.popup(pos, 'INTRUSION DETECTED', 'hostile'); game.feed(`Cyber op against ${c.name} was detected and repelled.`, 'bad'); }
      break;
    }
    case 'cyber_grid': {
      if (rng() < est.success) { c.gridDownUntil = game.time + 48; c.stability -= 10; game.world.recompute(c, game.time); game.fx.popup(pos, 'GRID DOWN', 'controlled'); game.feed(`${c.name}'s power grid collapses. Military logistics crippled.`, 'good'); game.globeFlash(c); game.medal('blackout'); }
      else { game.fx.popup(pos, 'ATTACK FAILED', 'hostile'); game.feed(`Grid attack on ${c.name} failed.`, 'bad'); }
      break;
    }
    case 'strike': {
      if (!site || !site.alive) { game.fx.explosion(pos, 0.8); break; }
      const t = SITE_TYPES[site.type];
      const power = u.type === 'orbital' ? 4 : u.type === 'bomber' ? 2.4 : u.cls === 'naval' ? 1.6 : u.type === 'drone' ? 1 : u.cls === 'cyber' ? 0 : 1.4;
      const accuracy = 0.55 + c.intel / 220;
      const s = u.cls === 'cyber' ? (u.t.cyber || 0) * 1.4 : (u.t.strike || 0);
      const intercepted = u.cls === 'naval' && rng() < (c.ad / 100) * 0.35;
      if (intercepted) { game.fx.explosion(pos.clone().multiplyScalar(1.03), 0.6, 0x99ccff); game.fx.popup(pos, 'INTERCEPTED', 'hostile'); break; }
      const dmg = s * 13 * (1 - t.hard * 0.45) * accuracy * (0.7 + rng() * 0.6);
      if (power > 0) { game.fx.explosion(pos, power); game.audio.explosion(power); }
      else { game.fx.popup(pos, 'PAYLOAD DEPLOYED', 'controlled'); game.audio.cyber(); }
      const killed = game.world.damageSite(site, dmg);
      game.collateral(c, est.collateral / Math.max(1, c.intel > 60 ? 2 : 1) / 2);
      if (killed) game.siteDestroyed(site, u, opKey);
      else game.fx.popup(pos, `${site.name} −${Math.round(dmg)}`, 'hostile');
      break;
    }
    case 'raid': {
      if (!site || !site.alive) break;
      game.fx.tracers(pos, pos.clone().multiplyScalar(1.02), 0xffe080, 10, 0.8);
      game.audio.gunfire();
      if (rng() < est.success) {
        game.world.damageSite(site, 9999);
        game.siteDestroyed(site, u, 'raid');
        game.fx.popup(pos, site.type === 'hostage' ? 'HOSTAGES RESCUED' : 'TARGET SECURED', 'controlled');
      } else {
        game.fx.popup(pos, 'RAID FAILED', 'hostile');
        game.feed(`${u.name} raid on ${site.name} went wrong.`, 'bad');
        game.approval -= 3;
        if (rng() < 0.4) game.unitLost(u, 'lost in a failed raid');
        if (site.type === 'hostage' && rng() < 0.5) { site.alive = false; game.failCrisisWhere(cr => cr.siteId === site.id, 'Hostages killed in failed rescue'); }
      }
      break;
    }
  }
}

/** Visualize the enemy's air defense reacting: SAM launches from live SAM sites, interceptors from air bases. */
function airDefenseShow(game, c, u, kill) {
  const w = game.world;
  const tgt = u.worldPos();
  const sams = w.sites.filter(s => s.ci === c.i && s.alive && s.type === 'ad');
  const bases = w.sites.filter(s => s.ci === c.i && s.alive && s.type === 'air');
  const adOn = c.adDownUntil <= game.time;
  let fired = false;
  if (sams.length && adOn && c.ad > 8) {
    const s = sams[Math.floor(game.rng() * sams.length)];
    const from = llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.002);
    const miss = tgt.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.01));
    game.audio.launchMissile();
    game.fx.projectile(from, kill ? tgt : miss, { peak: 0.015, duration: 1.2, color: 0xffffff, width: 0.6, onHit: (p) => {
      game.fx.explosion(p, kill ? 1.3 : 0.5, kill ? 0xff6040 : 0xffffff);
      if (!kill) game.fx.popup(p, 'EVADED', 'ally');
    } });
    fired = true;
  }
  if (bases.length && c.air > 15 && (!fired || game.rng() < 0.5)) {
    const b = bases[Math.floor(game.rng() * bases.length)];
    const from = llToVec3(b.ll[0], b.ll[1], GLOBE_R * 1.002);
    const jet = game.models.create('fighter', c.stance === 'rival' ? 'rival' : 'hostile', 0.02 * game.viewScale);
    game.fx.projectile(from, tgt, { peak: 0.02, duration: 1.1, color: 0xff7060, model: jet, onHit: (p) => {
      game.fx.tracers(p, tgt, 0xffd27a, 6, 0.5);
      game.audio.gunfire();
      // the escorts or the target win the merge if this wasn't a kill
      if (!kill) game.after(0.3, () => { game.fx.explosion(p, 0.9, 0xff5040); game.fx.popup(p, 'BANDIT DOWN', 'ally'); game.score += 5; });
    } });
  }
}

/** One bombing run during an air campaign. */
export function campaignSortie(game, u, c) {
  const targets = game.world.sites.filter(s => s.ci === c.i && game.world.visible(s) && !SITE_TYPES[s.type].cyberOnly && !SITE_TYPES[s.type].raidOnly);
  if (!targets.length) return false;
  const s = targets[Math.floor(game.rng() * targets.length)];
  const est = estimate(game, 'strike', c, s, [u]);
  const from = u.worldPos();
  const to = llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.002);
  game.fx.projectile(from, to, { peak: 0.01, duration: 0.9, color: 0xffc070, onHit: () => resolve(game, u, 'strike', c, s, est, s.ll) });
  return true;
}
