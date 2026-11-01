// Screenshot tour of the main UI surfaces.
export default async function (h) {
  await h.wait(1200);
  await h.eval(`document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.wait(800);
  await h.eval(`__game.ui.closeModal()`);
  // planner with route preview: strike on a hostile site using two assets
  await h.eval(`(() => { const g = __game; const c = g.world.countries.find(c => c.stance === 'hostile' && c.coastal) || g.world.countries.find(c => c.stance === 'hostile');
    window.__c = c; c.intel = 80; g.ui.openDossier(c); g.focusLL(c.ll, 2.6, 0.01); })()`);
  await h.wait(800);
  await h.eval(`(() => { const g = __game; const s = g.world.sitesOf(__c).find(s => g.world.visible(s));
    g.ui.openDossier(__c, { op: 'strike', site: s });
    const d = g.ui.dossier; const b = g.units.find(u => u.type === 'bomber'), f = g.units.find(u => u.type === 'fighter');
    d.picked = new Set([b.id, f.id]); g.ui.renderDossier(); })()`);
  await h.wait(1500);
  await h.shot('ui-1-planner');
  await h.eval(`document.getElementById('go').click()`);
  await h.wait(600);
  await h.shot('ui-2-codename');
  await h.eval(`__game.ui.procureMenu()`);
  await h.wait(500);
  await h.shot('ui-3-procure');
  await h.eval(`__game.ui.closeModal(); __game.ui.threatBoard()`);
  await h.wait(500);
  await h.shot('ui-4-threats');
  await h.eval(`__game.ui.closeModal(); __game.ui.closeDossier(); __game.ui.setSpeed(3); __game.focusLL(__c.ll, 1.35, 0.01)`);
  await h.wait(9000);
  await h.shot('ui-5-closeup');
}
