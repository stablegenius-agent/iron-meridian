// Show every dilemma once and pick a random option; screenshot the first.
export default async function (h) {
  await h.wait(1200);
  await h.eval(`localStorage.clear(); document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.eval(`__game.ui.closeModal()`);
  for (let i = 0; i < 10; i++) {
    await h.eval(`__game.dilemma()`);
    await h.wait(400);
    if (i === 0) await h.shot('dilemma');
    const title = await h.eval(`document.querySelector('#modal-body h2')?.textContent || '(none)'`);
    const n = await h.eval(`document.querySelectorAll('#modal-body [data-b]').length`);
    await h.eval(`(() => { const b = document.querySelectorAll('#modal-body [data-b]'); if (b.length) b[Math.floor(Math.random() * b.length)].click(); })()`);
    const st = await h.eval(`(() => { const g = __game; return 'appr ' + Math.round(g.approval) + ' tens ' + Math.round(g.tension) + ' bud ' + g.budget.toFixed(0) + ' units ' + g.units.length; })()`);
    h.log(`${title} [${n} options] -> ${st}`);
  }
}
