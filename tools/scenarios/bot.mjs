// Balance bot: plays a full campaign by following each crisis card's advice, at 8x speed.
// Reports day-by-day vitals and the final grade. Usage: node tools/playtest.mjs tools/scenarios/bot.mjs [--diff=1]
export default async function (h) {
  const diff = process.argv.find(a => a.startsWith('--diff='))?.split('=')[1] || '1';
  await h.wait(1200);
  await h.eval(`document.getElementById('opt-diff').value='${diff}'; document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.eval(`(() => {
    const g = __game;
    g.ui.closeModal();
    g.ui.setSpeed(8);
    const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
    const free = (types, ll) => g.units.filter(u => types.includes(u.type) && u.available && !(u.cls==='ground' && u.state==='onstation'))
      .sort((a, b) => dist(a.ll, ll) - dist(b.ll, ll));
    const handled = new Map();
    window.__bot = setInterval(() => {
      if (g.over) return;
      if (g.ui.modalOpen) g.ui.closeModal();
      for (const cr of g.crises) {
        if ((handled.get(cr.id) || -99) > g.time - 10) continue;
        const c = g.world.countries[cr.ci];
        const s = cr.siteId ? g.world.sites.find(x => x.id === cr.siteId) : null;
        const vis = s && g.world.visible(s);
        let ok = false;
        const go = (op, site, us) => { us = us.filter(Boolean); if (us.length) ok = g.order(op, c, site, us) || ok; };
        switch (cr.type) {
          case 'plot': case 'missile':
            if (vis) go('strike', s, free(['bomber','drone','destroyer','submarine'], s.ll).slice(0, 2));
            else go('recon', null, free(['satellite','drone'], c.ll).slice(0, 1));
            break;
          case 'cyber':
            if (vis) go('strike', s, free(['cyber'], c.ll).slice(0, 1)); else go('recon', null, free(['cyber','satellite'], c.ll).slice(0, 1));
            break;
          case 'hostage': go('raid', s, free(['sof'], s.ll).slice(0, 1)); break;
          case 'pirates': case 'rivalfleet': go('patrol', null, free(['destroyer','carrier','submarine'], c.ll).slice(0, 1)); break;
          case 'invasion': go('patrol', null, [...free(['fighter'], c.ll).slice(0, 2), ...free(['airborne','armor'], c.ll).slice(0, 1)]); break;
          case 'disaster': go('aid', null, free(['airborne'], c.ll).slice(0, 1)); break;
        }
        if (ok) handled.set(cr.id, g.time);
      }
      // keep tension in check with aid when it runs hot
      if (g.tension > 65) {
        const n = g.world.countries.find(c => c.stance === 'neutral' && c.pop > 1e7 && g.rng() < 0.2);
        const a = free(['airborne'], n ? n.ll : [0,0])[0];
        if (n && a) g.order('aid', n, null, [a]);
      }
    }, 400);
  })()`);
  let lastDay = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60 * 1000) {
    await h.wait(3000);
    const s = await h.eval(`(() => { const g = __game; return { over: g.over, day: g.day, t: Math.round(g.tension), a: Math.round(g.approval), b: Math.round(g.budget), sc: Math.round(g.score), cr: g.crises.length, won: g.log.crisesWon, lost: g.log.crisesLost, ul: g.log.unitsLost, medals: g.medals.length }; })()`);
    if (s.day >= lastDay + 5 || s.over) { h.log(JSON.stringify(s)); lastDay = s.day; }
    if (s.over) break;
  }
  const end = await h.eval(`(() => { const g = __game; return { final: g.finalScore(), rank: g.rank(), medals: g.medals, log: g.log, end: document.querySelector('#modal-body h2')?.textContent }; })()`);
  h.log('END', JSON.stringify(end));
  await h.shot('bot-end');
}
