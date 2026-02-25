const { google } = require('googleapis');

exports.handler = async function(event, context) {
    // 1. Cek metode HTTP (Hanya boleh POST untuk keamanan)
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        // 2. Ambil URL yang ingin di-index dari body request
        const body = JSON.parse(event.body);
        const targetUrl = body.url;

        if (!targetUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing target URL in request body' }) };
        }

        console.log(`[Bot] Memulai proses indexing untuk: ${targetUrl}`);

        // 3. Panggil Private Key JSON dari Environment Variables Netlify
        // Pastikan nama variabel 'GOOGLE_SERVICE_ACCOUNT_KEY' sesuai dengan yang Mas setting di Netlify
        const keyJsonString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY; 
        
        if (!keyJsonString) {
             console.error("[Bot Error] Environment Variable GOOGLE_SERVICE_ACCOUNT_KEY tidak ditemukan!");
             return { statusCode: 500, body: JSON.stringify({ error: 'Server Configuration Error' }) };
        }

        const credentials = JSON.parse(keyJsonString);

        // 4. Autentikasi dengan Google
        const jwtClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/indexing'],
            null
        );

        await jwtClient.authorize();

        // 5. Panggil Google Indexing API
        const indexing = google.indexing({ version: 'v3', auth: jwtClient });
        
        const response = await indexing.urlNotifications.publish({
            requestBody: {
                url: targetUrl,
                type: 'URL_UPDATED', // Gunakan 'URL_DELETED' jika menghapus halaman
            },
        });

        console.log(`[Bot] Sukses! Respon Google:`, response.data);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Permintaan indexing berhasil dikirim ke Google!',
                url: targetUrl,
                googleResponse: response.data
            })
        };

    } catch (error) {
        console.error('[Bot Error]', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Gagal melakukan indexing', details: error.message })
        };
    }
};