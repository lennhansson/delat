// jukebox-pwa.js

let deferredPrompt;

window.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('pwa-install-btn');
    const pwaInstruktion = document.getElementById('pwa-ios-instruktion');
    
    if (!installBtn) return;

    // 1. KOLLA OM DET ÄR IPHONE (iOS)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        // Appen är redan installerad och öppnad som en app!
        installBtn.style.display = 'none';
        if(pwaInstruktion) pwaInstruktion.innerHTML = "🟢 Öppnad via Jukebox-appen";
        return;
    }

    if (isIOS) {
        // Om det är en iPhone, ändra knappens text och visa instruktionen under när de trycker
        installBtn.innerText = "Installera 7-an Jukebox (iPhone)";
        installBtn.style.background = "#007aff"; // Apple-blå
        installBtn.style.color = "white";
        
        installBtn.addEventListener('click', () => {
            if(pwaInstruktion) {
                pwaInstruktion.style.display = 'block';
                pwaInstruktion.innerHTML = "ℹ️ <strong>För iPhone:</strong> Tryck på <strong>Dela-knappen</strong> i botten av Safari (fyrkanten med pilen uppåt) och välj sedan <strong>'Lägg till på startskärmen'</strong>. Kika efter Jukebox-ikonen!";
            }
        });
        return;
    }

    // 2. FÖR ANDROID (Fånga Chromes inbyggda installationsfönster)
    window.addEventListener('beforeinstallprompt', (e) => {
        // Hindra Chrome från att visa sitt eget fönster direkt
        e.preventDefault();
        deferredPrompt = e;
        
        // Visa vår snygga knapp för gästen
        installBtn.style.display = 'block';
        installBtn.innerText = "Installera Jukebox-appen 📱";
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
            alert("Appen kan tyvärr inte installeras direkt från den här webbläsaren. Prova att öppna länken i Google Chrome eller Safari!");
            return;
        }
        // Visa Androids installationsfönster
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('Gästen installerade appen!');
        }
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
});