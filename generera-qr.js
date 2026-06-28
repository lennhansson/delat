const fs = require('fs');
const QRCode = require('qrcode');

const URL = 'https://lenn-test-jb.loca.lt/mobile';
const ANTAL = 21;

async function skapaArk() {
  try {
    // Generera QR-koden som en Base64-bildsträng
    const qrImageWithUrl = await QRCode.toDataURL(URL, {
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // Skapa 21 stycken likadana block
    let qrBlockHtml = '';
    for (let i = 0; i < ANTAL; i++) {
      qrBlockHtml += `
        <div class="qr-box">
          <img src="${qrImageWithUrl}" alt="QR">
          <div class="text">SKANNA FÖR ATT ÖNSKA LÅT</div>
          <div class="sub-text">lenn-test-jb.loca.lt</div>
        </div>
      `;
    }

    // HTML-struktur med CSS Grid inställt för ett A4 utan marginaler (3 kolumner x 7 rader = 21 st)
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="sv">
    <head>
      <meta charset="UTF-8">
      <title>QR-kod Ark (21 st)</title>
      <style>
        @page {
          size: A4;
          margin: 0; /* Tar bort skrivarens standardmarginaler */
        }
        body {
          margin: 0;
          padding: 0;
          font-family: system-ui, sans-serif;
          background: white;
          width: 210mm;
          height: 297mm;
          box-sizing: border-box;
        }
        .grid-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr); /* 3 spalter */
          grid-template-rows: repeat(7, 1fr);    /* 7 rader */
          width: 210mm;
          height: 297mm;
          box-sizing: border-box;
        }
        .qr-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border: 1px dashed #ccc; /* Klipplinjer, ta bort eller ändra till solid om du vill ha synliga ramar */
          box-sizing: border-box;
          padding: 10px;
          text-align: center;
          background: #fff;
          overflow: hidden;
        }
        img {
          width: 75%;
          max-width: 120px;
          height: auto;
          display: block;
        }
        .text {
          font-size: 11px;
          font-weight: bold;
          margin-top: 5px;
          letter-spacing: 0.5px;
          color: #111;
        }
        .sub-text {
          font-size: 9px;
          color: #666;
          margin-top: 2px;
        }
      </style>
    </head>
    <body>
      <div class="grid-container">
        ${qrBlockHtml}
      </div>
    </body>
    </html>
    `;

    fs.writeFileSync('qr-ark.html', htmlContent);
    console.log('Klart! Öppna "qr-ark.html" i din webbläsare och skriv ut/spara som PDF.');
  } catch (err) {
    console.error('Något gick fel:', err);
  }
}

skapaArk();