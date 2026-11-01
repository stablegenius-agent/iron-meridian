// After a load: does time advance? Is anything blocking (modal, over flag)?
export default async function (h) {
  await h.wait(1200);
  await h.eval(`localStorage.clear(); document.querySelector('[data-mode="campaign"]').click()`);
  await h.until('__game.started');
  await h.eval(`__game.ui.closeModal(); __game.ui.setSpeed(4)`);
  await h.until('__game.day >= 2', 60000);
  await h.eval(`__game.save(); location.reload()`);
  await h.wait(1500);
  await h.until('!!window.__game', 30000);
  await h.until(`!document.getElementById('btn-continue').classList.contains('hidden')`, 10000);
  await h.eval(`document.getElementById('btn-continue').click()`);
  await h.until('__game.started');
  const s = () => h.eval(`(() => { const g = __game; return { t: g.time.toFixed(2), speed: g.speed, modal: g.ui.modalOpen, over: g.over }; })()`);
  h.log('t0', JSON.stringify(await s()));
  await h.wait(3000);
  h.log('t+3s (speed as loaded)', JSON.stringify(await s()));
  await h.eval(`__game.ui.setSpeed(4)`);
  await h.wait(3000);
  h.log('t+6s (speed 4)', JSON.stringify(await s()));
}
