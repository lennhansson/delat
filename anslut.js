const form = document.querySelector('#application-form');
const status = document.querySelector('#application-status');
const button = form.querySelector('button[type="submit"]');
document.querySelector('#print-terms').addEventListener('click', () => window.print());
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || !form.reportValidity()) return;
  const phone = form.elements['Mobilnummer'];
  if (!/^[+\d\s().-]{7,30}$/.test(phone.value) || phone.value.replace(/\D/g,'').length < 7) {
    status.textContent = 'Kontrollera mobilnumret.'; phone.focus(); return;
  }
  const payload = Object.fromEntries(new FormData(form));
  for (const name of ['Behörighet','Musikrättigheter','Villkor']) {
    if (!form.elements[name].checked) return;
    payload[name] = form.elements[name].closest('label').innerText.trim();
  }
  payload['E-post för avräkning'] ||= payload.email;
  payload._subject = 'Foxbox Jukebox AB – ansökan om anslutning';
  payload._template = 'table';
  payload['Villkorsversion'] = '1.2 / 2026-09-13';
  payload['Villkor vid ansökan'] = document.querySelector('#terms-text').innerText;
  payload['Tid enligt sökandens enhet (UTC)'] = new Date().toISOString();
  payload['Källa'] = location.href.split('#')[0];
  button.disabled = true; status.textContent = 'Skickar ansökan…';
  try {
    const response = await fetch('https://formsubmit.co/ajax/ansokan@foxbox.host', {
      method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(payload), signal:AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!response.ok || ![true,'true'].includes(result.success) || /activat|confirm/i.test(result.message || '')) throw new Error('Unconfirmed');
    status.textContent = 'Tack! Ansökan har skickats för handläggning. Foxbox Jukebox AB återkommer med skriftlig bekräftelse innan avtalet börjar gälla och tjänsten aktiveras.';
    button.textContent = 'Ansökan skickad';
  } catch {
    status.replaceChildren(document.createTextNode('Vi kunde inte bekräfta att ansökan skickades. Uppgifterna finns kvar. Försök igen eller '));
    const link = document.createElement('a'); link.href = 'mailto:ansokan@foxbox.host';
    link.textContent = 'kontakta oss via e-post'; link.style.textDecoration='underline'; status.append(link);
    button.disabled = false;
  }
});
