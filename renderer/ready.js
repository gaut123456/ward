const button = document.querySelector('#accept');
const message = document.querySelector('#ready-feedback');
let ready = null, busy = false, acceptedLocally = false, errorText = '';
function render() {
  const accepted = acceptedLocally || ready?.response === 'Accepted';
  const remaining = ready?.active && ready.deadline !== null ? Math.max(0, ready.deadline - Date.now()) : null;
  button.disabled = busy || !ready?.active || accepted || ready?.response === 'Declined';
  button.textContent = busy ? 'Acceptation…' : accepted ? 'Partie acceptée' : 'Accepter';
  document.querySelector('#countdown').textContent = accepted ? '✓' : remaining === null ? '—' : Math.ceil(remaining / 1000);
  document.querySelector('#clock-progress').style.strokeDashoffset = accepted ? 0 : remaining === null ? 100 : 100 - Math.min(100, remaining / ready.duration * 100);
  document.querySelector('#ready-clock').classList.toggle('accepted', accepted);
  document.querySelector('#ready-clock').classList.toggle('urgent', !accepted && remaining !== null && remaining < 4000);
  document.querySelector('#ready-title').textContent = accepted ? 'C’est confirmé.' : 'À toi de jouer.';
  document.querySelector('#ready-subtitle').textContent = accepted ? 'En attente des joueurs…' : 'La faille t’attend.';
  message.textContent = errorText || (accepted ? 'League s’ouvrira pour choisir ton champion.' : ready?.active ? 'Solo / Duo · Faille de l’invocateur' : 'Synchronisation avec League…');
  message.classList.toggle('error', Boolean(errorText));
}
function update(value) { ready = value; render(); }
window.league.onReadyCheck(update);
window.league.getReadyState().then(update).catch(() => { errorText = 'Connexion à League indisponible'; render(); });
button.addEventListener('click', async () => {
  if (button.disabled) return;
  busy = true; errorText = ''; render();
  try { await window.league.acceptReady(); acceptedLocally = true; }
  catch (error) { errorText = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  finally { busy = false; render(); }
});
document.querySelector('#close').addEventListener('click', () => window.league.hideReady());
setInterval(render, 100);
