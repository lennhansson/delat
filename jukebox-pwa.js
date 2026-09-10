// jukebox-pwa.js

let deferredPrompt;

window.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('pwa-install-btn');
    const pwaInstruktion = document.getElementById('pwa-ios-instruktion');
    const statusInstalled = document.getElementById('pwa-status-installed');

    if (!installBtn) return;

    // Hämta pub-namnet från URL:en (t.ex. 7-an)
    const pathParts = window.location.pathname.split('/');
    const pubId = pathParts[2] || "Jukebox";
    const appName = pubId.charAt(0).toUpperCase() + pubId.slice(1);

    // 1. KOLLA OM DEN REDAN ÄR INSTALLERAD
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        installBtn.style.display = 'none';
        if(pwaInstruktion) pwaInstruktion.style.display = 'none';
        if(statusInstalled) statusInstalled.style.display = 'block';
        return;
    }

    // 2. KOLLA PLATTFORM
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
        if(pwaInstruktion) {
            pwaInstruktion.style.display = 'block';
            pwaInstruktion.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <span style="font-size:24px;">🎵</span>
                    <strong>Spara ${appName} på hemskärmen</strong>
                </div>
                <ol style="margin:0; padding-left:20px; line-height:1.6;">
                    <li>Tryck på <strong>Dela-knappen</strong> i Safari (fyrkanten med pil upp <span style="font-size:18px;">⎋</span>)</li>
                    <li>Välj <strong>"Lägg till på hemskärmen"</strong></li>
                </ol>
            `;
        }
        return;
    }

    // 3. ANDROID / DESKTOP
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'block';
        installBtn.innerText = `Installera ${appName}-appen 📱`;
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
            if(statusInstalled) statusInstalled.style.display = 'block';
        }
        deferredPrompt = null;
    });
});