const { google } = require('googleapis');

exports.handler = async function(event, context) {
    // Hanya menerima request POST
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const body = JSON.parse(event.body);

        /* ========================================================
           1. FITUR GOOGLE INDEXING API
           Mengeksekusi jika payload memiliki parameter 'url'
        ======================================================== */
        if (body.url && !body.message) {
            const targetUrl = body.url;
            console.log(`[Indexing Bot] Memproses: ${targetUrl}`);

            // Ambil Variabel Gabungan (GOOGLE_CREDENTIALS)
            const credsString = process.env.GOOGLE_CREDENTIALS;
            if (!credsString) {
                throw new Error(`Kredensial GOOGLE_CREDENTIALS kosong. Pastikan sudah di-setting di Netlify Variables.`);
            }

            let credentials;
            try {
                // Parse string JSON 1 baris kembali jadi objek
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
            return { 
                statusCode: 200, 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ message: 'Instruksi indexing diterima Google!', url: targetUrl }) 
            };
        }

        /* ========================================================
           2. FITUR CHATBOT AI & PAGESPEED INSIGHTS
           Mengeksekusi jika payload memiliki parameter 'message'
        ======================================================== */
        if (body.message) {
            const GROQ_API_KEY = process.env.GROQ_API_KEY;
            const PGSPEED_API_KEY = process.env.PGSPEED_API_KEY;
            
            let userMessage = body.message;
            const model = "llama3-70b-8192"; 

            let systemPrompt = "Anda adalah asisten virtual cerdas milik Faqih (SEO Specialist). Jawab selalu dalam bahasa Indonesia dengan ringkas, ramah, dan solutif (maksimal 3 hingga 4 kalimat pendek). DILARANG KERAS MENGGUNAKAN SIMBOL BINTANG.";
            let finalPrompt = userMessage;

            // Deteksi cerdas apakah input pengguna adalah URL
            const isUrl = /^https?:\/\//i.test(userMessage) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(userMessage);

            if (isUrl) {
                let targetUrl = userMessage;
                if (!/^https?:\/\//i.test(targetUrl)) {
                    targetUrl = 'https://' + targetUrl;
                }

                const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${PGSPEED_API_KEY}`;
                let scoreStr = "Tidak bisa diukur";
                
                try {
                    const psRes = await fetch(psUrl);
                    const psData = await psRes.json();
                    
                    if (psData && psData.lighthouseResult && psData.lighthouseResult.categories && psData.lighthouseResult.categories.performance) {
                        const score = Math.round(psData.lighthouseResult.categories.performance.score * 100);
                        scoreStr = `${score} dari 100`;
                    }
                } catch (err) {
                    scoreStr = "(Gagal menarik skor web)";
                }

                finalPrompt = `Saya baru saja mengecek performa kecepatan website URL ini: ${targetUrl}. Skor kinerjanya adalah ${scoreStr}. Tolong analisis secara sangat singkat apa arti skor tersebut dan berikan 2 poin saran cepat untuk optimasi SEO. Jawab TANPA MENGGUNAKAN SIMBOL BINTANG.`;
            }

            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: finalPrompt }
                    ],
                    max_tokens: 250
                })
            });

            if (!groqRes.ok) throw new Error(`Groq API Error Status ${groqRes.status}`);

            const groqData = await groqRes.json();
            
            // Pengamanan esktra ganda: bersihkan teks dari sisa simbol bintang
            let replyText = groqData.choices[0].message.content;
            replyText = replyText.replace(/\*/g, '');

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reply: replyText })
            };
        }

        // Jika Payload tidak memiliki url maupun message
        return { 
            statusCode: 400, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ error: 'Payload request tidak valid atau tidak dikenali.' }) 
        };

    } catch (error) {
        console.error('[Function Error]', error.message);
        
        // Response Khusus Jika Error dari Google Indexing API
        if (error.message.includes('GOOGLE_CREDENTIALS') || error.message.includes('private_key') || error.message.includes('indexing')) {
            let errorMsg = 'Gagal menghubungi Google Indexing API.';
            if (error.message.includes('Permission denied')) errorMsg = 'Akses Ditolak: Email bot (Service Account) belum ditambahkan sebagai OWNER di GSC.';
            else if (error.message.includes('not been used') || error.message.includes('disabled')) errorMsg = 'Google Indexing API Belum Diaktifkan di Google Cloud Console.';
            else if (error.message.includes('PEM') || error.message.includes('DECODER')) errorMsg = 'Format Private Key Ditolak Google. Cek kembali Variabel Netlify.';
            else errorMsg = `Error Indexing: ${error.message}`;
            
            return { 
                statusCode: 500, 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ error: errorMsg, details: error.message }) 
            };
        }

        // Response Error General / Chatbot
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: "Maaf, sistem sedang sibuk memproses antrean. Mohon ketik kembali pertanyaan Anda sebentar lagi." })
        };
    }
};
