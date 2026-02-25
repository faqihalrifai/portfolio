const { google } = require('googleapis');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { url: targetUrl } = JSON.parse(event.body);
    if (!targetUrl) throw new Error('Parameter URL hilang di body request.');

    console.log(`[Indexing Bot] Memproses: ${targetUrl}`);

    // Ambil Variabel Gabungan (GOOGLE_CREDENTIALS)
    const credsString = process.env.GOOGLE_CREDENTIALS;
    if (!credsString) {
      throw new Error(`Kredensial GOOGLE_CREDENTIALS kosong. Pastikan sudah di-setting di Netlify.`);
    }

    let credentials;
    try {
      // Parse string JSON 1 baris tadi kembali jadi objek
      credentials = JSON.parse(credsString);
    } catch (e) {
      throw new Error(`Format JSON di GOOGLE_CREDENTIALS tidak valid. Pastikan copy-paste utuh satu baris tanpa terpotong.`);
    }

    const clientEmail = credentials.client_email;
    let privateKey = credentials.private_key;

    if (!clientEmail || !privateKey) {
      throw new Error('Properti client_email atau private_key tidak ditemukan di dalam JSON.');
    }

    // Pastikan \n dirender sebagai baris baru oleh Node.js agar tidak error DECODER
    privateKey = privateKey.replace(/\\n/g, '\n');

    const jwtClient = new google.auth.JWT(
      clientEmail, 
      null, 
      privateKey, 
      ['https://www.googleapis.com/auth/indexing'], 
      null
    );
    
    await jwtClient.authorize();

    const response = await google.indexing({ version: 'v3', auth: jwtClient }).urlNotifications.publish({
      requestBody: { url: targetUrl, type: 'URL_UPDATED' }
    });

    console.log(`[Indexing Bot] Sukses:`, response.data);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Instruksi indexing diterima Google!', url: targetUrl }) };

  } catch (error) {
    console.error('[Indexing Bot] Gagal:', error.message);
    let errorMsg = 'Gagal menghubungi Google Indexing API.';
    
    if (error.message.includes('Permission denied')) errorMsg = 'Akses Ditolak: Email bot belum jadi OWNER di GSC.';
    else if (error.message.includes('not been used') || error.message.includes('disabled')) errorMsg = 'API Belum Aktif di Google Cloud Console.';
    else if (error.message.includes('PEM') || error.message.includes('DECODER')) errorMsg = 'Format Private Key Masih Ditolak Google. Cek Variabel Netlify.';
    else errorMsg = `Error: ${error.message}`;
    
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: errorMsg, details: error.message }) };
  }
};
