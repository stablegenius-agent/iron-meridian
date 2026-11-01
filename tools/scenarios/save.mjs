// Save/load round trip: play a few days (with a procurement and some strikes), reload, continue, compare.
export default async function (h) {
  await h.wait(1200);
  await h.eval(`localStorage.clear(); document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.eval(`(() => { const g = __game; g.ui.closeModal();
    const c = g.world.countries.find(c => c.stance === 'hostile'); c.intel = 90;
    const s = g.world.sitesOf(c).find(s => g.world.visible(s));
    g.order('strike', c, s, [g.units.find(u => u.type === 'bomber')]);
    g.procure('drone'); g.ui.setSpeed(4); })()`);
  await h.until('__game.day >= 4', 120000);
  await h.eval(`__game.save()`);
  const before = await h.eval(`(() => { const g = __game; return { day: g.day, score: Math.round(g.score), approval: Math.round(g.approval),
    hostile: g.world.countries.filter(c => c.stance === 'hostile').map(c => c.id).sort().join(','),
    sitesAlive: g.world.sites.filter(s => s.alive).length, units: g.units.length, medals: g.medals.join(',') }; })()`);
  h.log('before', JSON.stringify(before));
  await h.eval(`location.reload()`);
  await h.wait(1500);
  await h.until('!!window.__game', 30000);
  await h.until(`!document.getElementById('btn-continue').classList.contains('hidden')`, 10000);
  await h.eval(`document.getElementById('btn-continue').click()`);
  await h.until('__game.started');
  await h.wait(500);
  const after = await h.eval(`(() => { const g = __game; return { day: g.day, score: Math.round(g.score), approval: Math.round(g.approval),
    hostile: g.world.countries.filter(c => c.stance === 'hostile').map(c => c.id).sort().join(','),
    sitesAlive: g.world.sites.filter(s => s.alive).length, units: g.units.length, medals: g.medals.join(',') }; })()`);
  h.log('after ', JSON.stringify(after));
  for (const k of Object.keys(before)) if (before[k] !== after[k]) h.log(`MISMATCH ${k}: ${before[k]} -> ${after[k]}`);
  await h.eval(`__game.ui.setSpeed(4)`);
  await h.wait(6000);
  h.log('continued to day', await h.eval('__game.day'));
  await h.shot('save-continued');
}
