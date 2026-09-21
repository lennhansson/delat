const form = document.querySelector('#lead-form');
const status = document.querySelector('#form-status');
const phone = document.querySelector('#phone');
const email = document.querySelector('#email');
const submit = form.querySelector('button[type="submit"]');

function validateContact(phoneValue, emailValue) {
  if (!phoneValue && !emailValue) return 'Fyll i mobilnummer eller e-postadress så att vi kan nå dig.';
  if (phoneValue && (!/^[+\d\s().-]+$/.test(phoneValue) || phoneValue.replace(/\D/g, '').length < 7 || phoneValue.replace(/\D/g, '').length > 15)) return 'Kontrollera mobilnumret. Använd 7–15 siffror, gärna med landskod.';
  return '';
}

[phone, email].forEach(input => input.addEventListener('input', () => {
  status.textContent = '';
  status.classList.remove('error');
  phone.removeAttribute('aria-invalid');
  email.removeAttribute('aria-invalid');
}));

form.addEventListener('submit', async event => {
  event.preventDefault();
  const phoneValue = phone.value.trim();
  const emailValue = email.value.trim();
  const error = validateContact(phoneValue, emailValue);
  if (error) {
    status.textContent = error;
    status.classList.add('error');
    phone.setAttribute('aria-invalid', 'true');
    phone.focus();
    return;
  }
  if (!form.reportValidity()) return;
  submit.disabled = true;
  submit.innerHTML = 'Skickar…';
  status.classList.remove('error');
  status.textContent = '';
  const payload = {
    Mobilnummer: phoneValue,
    _subject: 'Rock-Ola – ny intresseanmälan',
    _template: 'table',
    _honey: form.elements._honey.value,
    Källa: window.location.href.split('#')[0],
  };
  if (emailValue) payload.email = emailValue;
  try {
    const response = await fetch('https://formsubmit.co/ajax/mika.pirttimaeki@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || (result.success !== true && result.success !== 'true')) throw new Error('Submission rejected');
    if (/activat|confirm/i.test(result.message || '')) throw new Error('Form not activated');
    status.textContent = 'Tack! Din intresseanmälan är skickad. Vi hör av oss och pratar om ditt ställe.';
    form.reset();
  } catch {
    status.replaceChildren(document.createTextNode('Vi kunde inte bekräfta att formuläret skickades. Dina uppgifter finns kvar. Försök igen eller '));
    const link = document.createElement('a');
    link.textContent = 'mejla Mika direkt';
    link.style.textDecoration = 'underline';
    link.href = 'mailto:mika.pirttimaeki@gmail.com?subject=' + encodeURIComponent('Intresse för Rock-Ola') + '&body=' + encodeURIComponent('Hej! Jag vill veta mer om Rock-Ola.\n\nMobilnummer: ' + phoneValue + '\nE-post: ' + emailValue);
    status.append(link, document.createTextNode('.'));
    status.classList.add('error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Ja, berätta mer <span aria-hidden="true">↗</span>';
  }
});

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('.motion-toggle');
let paused = prefersReducedMotion.matches;
function setMotion(value) {
  paused = value;
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Animationer pausade' : 'Pausa animationer';
}
setMotion(paused);
motionButton.addEventListener('click', () => setMotion(!paused));
prefersReducedMotion.addEventListener('change', event => setMotion(event.matches));
if ('IntersectionObserver' in window && !prefersReducedMotion.matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }), { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  document.documentElement.classList.add('motion-ready');
}

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'prepare_rockola_contact_request',
      title: 'Förbered kontakt med Rock-Ola',
      description: 'Fyll i kontaktformuläret med mobilnummer, e-post eller båda. Skickar inte uppgifterna; användaren granskar och klickar på Ja, berätta mer.',
      inputSchema: { type: 'object', properties: { phone: { type: 'string', maxLength: 30 }, email: { type: 'string', maxLength: 254 } }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['phone', 'email'].includes(key))) throw new Error('Ogiltiga kontaktuppgifter.');
        if ((input.phone !== undefined && typeof input.phone !== 'string') || (input.email !== undefined && typeof input.email !== 'string')) throw new Error('Kontaktuppgifter måste vara text.');
        const nextPhone = (input.phone || '').trim();
        const nextEmail = (input.email || '').trim();
        const error = validateContact(nextPhone, nextEmail);
        if (error || nextPhone.length > 30 || nextEmail.length > 254 || (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail))) throw new Error(error || 'Kontrollera e-postadressen.');
        phone.value = nextPhone;
        email.value = nextEmail;
        phone.dispatchEvent(new Event('input'));
        document.querySelector('#kom-igang').scrollIntoView({ behavior: paused ? 'instant' : 'smooth' });
        submit.focus({ preventScroll: true });
        return { status: 'prepared', sent: false, nextStep: 'Granska och klicka på Ja, berätta mer för att skicka.' };
      }
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* The form remains available when WebMCP is unsupported. */ }
}
