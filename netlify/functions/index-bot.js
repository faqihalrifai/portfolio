const { google } = require('googleapis');

exports.handler = async function(event, context) {
  // 1. Validasi HTTP Method (Hanya menerima POST)
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed. Silakan gunakan metode POST.' })
    };
  }

  try {
    // 2. Parsing & Validasi Payload Request
    const body = JSON.parse(event.body);
    const targetUrl = body.url;

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Bad Request. Parameter URL tidak ditemukan di body request.' })
      };
    }

    console.log(`[Indexing Bot] Memulai proses indexing untuk URL: ${targetUrl}`);

    // 3. Ambil Kredensial dari Variabel
    const clientEmail = process.env.GSC_CLIENT_EMAIL;
    let privateKey = process.env.GSC_PRIVATE_KEY;
    
    // DETEKSI ERROR LENGKAP: Cek persis variabel mana yang tidak terbaca Netlify
    if (!clientEmail || !privateKey) {
      let missingVars = [];
      if (!clientEmail) missingVars.push("GSC_CLIENT_EMAIL");
      if (!privateKey) missingVars.push("GSC_PRIVATE_KEY");
      
      console.error(`[Indexing Bot] Error: Variabel berikut kosong/tidak terbaca: ${missingVars.join(', ')}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Server Configuration Error. Netlify tidak bisa membaca variabel: ${missingVars.join(', ')}. Lakukan Clear Cache & Deploy Site!` })
      };
    }

    // 4. Pembersihan Private Key (Auto-Fix jika tercopy tanda kutip " di awal/akhir)
    privateKey = privateKey.replace(/^["']|["']$/g, '');
    // Format ulang \n agar Private Key terbaca benar oleh sistem kriptografi Google
    privateKey = privateKey.replace(/\\n/g, '\n');

    // 5. Autentikasi JWT ke Google API
    const jwtClient = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/indexing'],
      null
    );

    await jwtClient.authorize();

    // 6. Eksekusi Permintaan Google Indexing API
    const indexing = google.indexing({ version: 'v3', auth: jwtClient });
    
    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url: targetUrl,
        type: 'URL_UPDATED', 
      },
    });

    console.log(`[Indexing Bot] API Sukses. Respon Google:`, response.data);

    // 7. Kembalikan Response Sukses ke Frontend
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Bot Google telah menerima instruksi perayapan!',
        url: targetUrl,
        googleResponse: response.data
      })
    };

  } catch (error) {
    // Penanganan Error Global (Misal: Email belum dijadikan Owner di GSC)
    console.error('[Indexing Bot] Eksekusi Gagal:', error.message);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Gagal menghubungi Google Indexing API.',
        details: error.message
      })
    };
  }
};
