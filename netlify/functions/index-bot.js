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

    // 3. Ambil Kredensial dari Variabel Netlify
    const clientEmail = process.env.GOOGLE_SERVICE_EMAIL;
    let privateKey = process.env.GOOGLE_SERVICE_KEY;
    
    // Cek apakah variabel terbaca
    if (!clientEmail || !privateKey) {
      let missingVars = [];
      if (!clientEmail) missingVars.push("GOOGLE_SERVICE_EMAIL");
      if (!privateKey) missingVars.push("GOOGLE_SERVICE_KEY");
      
      console.error(`[Indexing Bot] Error: Variabel kosong: ${missingVars.join(', ')}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Server Configuration Error. Netlify tidak bisa membaca variabel: ${missingVars.join(', ')}. Lakukan Clear Cache & Deploy Site!` })
      };
    }

    // ====================================================================
    // 4. PERBAIKAN SUPER TANGGUH UNTUK PRIVATE KEY (Anti-Error DECODER)
    // ====================================================================
    
    // A. Hapus tanda kutip jika tidak sengaja terbawa saat copy-paste
    privateKey = privateKey.replace(/^["']|["']$/g, '');
    
    // B. Ganti teks literal \n menjadi baris baru (newline) beneran
    privateKey = privateKey.replace(/\\n/g, '\n');

    // C. FIX UTAMA: Jika Netlify menghancurkan format multiline menjadi 1 baris
    // (Inilah yang menyebabkan pesan "DECODER routines::unsupported")
    if (!privateKey.includes('\n')) {
      const beginHeader = '-----BEGIN PRIVATE KEY-----';
      const endHeader = '-----END PRIVATE KEY-----';
      
      if (privateKey.includes(beginHeader) && privateKey.includes(endHeader)) {
          // Ekstrak teks acak di tengahnya, lalu hapus SEMUA spasi kosong
          let base64Body = privateKey.replace(beginHeader, '').replace(endHeader, '').replace(/\s+/g, '');
          // Rakit ulang menjadi format standar yang diwajibkan sistem Google
          privateKey = `${beginHeader}\n${base64Body}\n${endHeader}`;
      }
    }

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
    console.error('[Indexing Bot] Eksekusi Gagal:', error.message);
    
    let pesanError = 'Gagal menghubungi Google Indexing API.';
    if (error.message.includes('Permission denied')) {
        pesanError = 'Akses Ditolak: Email bot belum ditambahkan sebagai OWNER (Pemilik) di pengaturan Google Search Console.';
    } else if (error.message.includes('not been used') || error.message.includes('disabled')) {
        pesanError = 'API Belum Aktif: Masuk ke Google Cloud Console dan aktifkan "Web Search Indexing API" untuk proyek Anda.';
    } else if (error.message.includes('PEM') || error.message.includes('key') || error.message.includes('DECODER')) {
        pesanError = 'Format Private Key Rusak Parah. Pastikan copy-paste di Netlify tepat. Error: ' + error.message;
    } else {
        pesanError = `Error dari Google: ${error.message}`;
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: pesanError,
        details: error.message
      })
    };
  }
};
