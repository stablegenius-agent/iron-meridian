// Smoke test: start a campaign, dismiss the briefing, exercise every operation type, fast-forward, screenshot.
export default async function (h) {
  await h.wait(1500);
  await h.eval(`document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.wait(1200);
  await h.shot('01-briefing');
  await h.eval(`document.querySelector('#modal-body [data-b="0"]').click()`);
  await h.wait(2500);
  await h.shot('02-hud');

  const info = await h.eval(`(() => { const g = __game, w = g.world;
    return { rivals: w.rivals.map(r => r.name), hostiles: w.countries.filter(c => c.stance==='hostile').map(c=>c.name),
      allies: w.countries.filter(c => c.stance==='ally').length, sites: w.sites.length, units: g.units.length, crises: g.crises.map(c=>c.title) }; })()`);
  h.log(JSON.stringify(info));

  // Pick a hostile target, open its dossier, run recon with a satellite, then cyber-blind, then strike.
  await h.eval(`(() => { const g = __game; window.__t = g.world.countries.find(c => c.stance === 'hostile');
    g.ui.openDossier(__t); g.focusLL(__t.ll, 2.0); })()`);
  await h.wait(1500);
  await h.shot('03-dossier');
  await h.eval(`(() => { const g = __game, c = __t; const sat = g.units.find(u => u.type==='satellite');
    g.order('recon', c, null, [sat]); const cy = g.units.find(u => u.type==='cyber'); g.order('cyber_ad', c, null, [cy]); })()`);
  await h.wait(4000);
  const vis = await h.eval(`__game.world.sitesOf(__t).filter(s => __game.world.visible(s)).map(s => s.name)`);
  h.log('visible sites after recon:', JSON.stringify(vis));
  await h.eval(`(() => { const g = __game, c = __t; const s = g.world.sitesOf(c).find(s => g.world.visible(s));
    const b = g.units.find(u => u.type==='bomber' && u.available); const d = g.units.find(u => u.type==='destroyer' && u.available);
    g.order('strike', c, s, [b]); g.order('strike', c, s, [d]); g.ui.setSpeed(3); })()`);
  for (let i = 0; i < 6; i++) { await h.wait(2000); }
  await h.shot('04-strike');

  // Every remaining op type somewhere.
  await h.eval(`(() => { const g = __game, w = g.world;
    const ally = w.countries.find(c => c.stance === 'ally' && c.coastal);
    g.order('patrol', ally, null, [g.units.find(u => u.type==='carrier')]);
    g.order('patrol', ally, null, [g.units.find(u => u.type==='fighter' && u.available)]);
    const neutral = w.countries.find(c => c.stance === 'neutral' && c.pop > 1e7);
    g.order('aid', neutral, null, [g.units.find(u => u.type==='airborne')]);
    const h2 = w.countries.filter(c => c.stance === 'hostile')[1];
    g.order('cyber_grid', h2, null, [g.units.filter(u => u.type==='cyber').find(u=>u.available)]);
    if (h2.coastal) g.order('blockade', h2, null, [g.units.find(u => u.type==='submarine')]);
    g.order('invade', h2, null, g.units.filter(u => u.type==='armor' || (u.type==='airborne' && u.available)));
    const crisis = g.crises[0]; if (crisis) g.ui.renderCrises();
    g.ui.setSpeed(8);
  })()`);
  for (let i = 0; i < 10; i++) await h.wait(2000);
  await h.shot('05-later');
  const state = await h.eval(`(() => { const g = __game; return { day: g.day, tension: Math.round(g.tension), approval: Math.round(g.approval),
    budget: Math.round(g.budget), score: Math.round(g.score), crises: g.crises.map(c=>c.title), fps: Math.round(g.fps),
    units: g.units.map(u => u.callsign + ':' + u.state).join(' ') }; })()`);
  h.log(JSON.stringify(state, null, 1));
}
