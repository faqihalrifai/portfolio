exports.handler = async function(event, context) {
    // Keamanan Protokol: Hanya mengizinkan request POST
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const body = JSON.parse(event.body);

        // 1. FITUR GOOGLE INDEXING API (Hanya dieksekusi jika mengirim 'url')
        if (body.url && !body.message) {
            const targetUrl = body.url;
            console.log(`[Indexing Bot] Memproses URL: ${targetUrl}`);

            // DYNAMIC REQUIRE: Mencegah crash global jika dependensi googleapis belum terinstal sempurna
            let google;
            try {
                google = require('googleapis').google;
            } catch (e) {
                console.error("[Indexing Bot] Modul googleapis tidak ditemukan.");
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        error: "Modul 'googleapis' belum terinstal di Netlify server. Silakan pastikan package.json Anda sudah terunggah ke repositori." 
                    })
                };
            }

            // Membaca Kredensial Akun Google GSC
            const credsString = process.env.GOOGLE_CREDENTIALS;
            if (!credsString) {
                throw new Error('Kredensial GOOGLE_CREDENTIALS kosong di pengaturan Netlify.');
            }

            let credentials;
            try {
                credentials = JSON.parse(credsString);
            } catch (e) {
                throw new Error('Format JSON GOOGLE_CREDENTIALS tidak valid atau terpotong.');
            }

            const clientEmail = credentials.client_email;
            let privateKey = credentials.private_key;

            if (!clientEmail || !privateKey) {
                throw new Error('Kunci akses client_email atau private_key tidak ditemukan di JSON.');
            }

            // Normalisasi baris baru private key SSH
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

            return { 
                statusCode: 200, 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ message: 'Instruksi indexing diterima Google!', url: targetUrl, details: response.data }) 
            };
        }

        // 2. FITUR CHATBOT AI (Dieksekusi jika mengirim 'message')
        if (body.message) {
            const GROQ_API_KEY = process.env.GROQ_API_KEY;
            const PGSPEED_API_KEY = process.env.PGSPEED_API_KEY;
            
            let userMessage = body.message;
            const model = "llama3-70b-8192"; // Menggunakan LLM tangguh & cerdas

            let systemPrompt = "Anda adalah asisten virtual cerdas milik Muhammad Faqih (seorang Digital Marketer). Jawablah selalu dalam bahasa Indonesia secara ringkas, ramah, profesional, dan solutif (maksimal 3 sampai 4 kalimat pendek). Jangan gunakan simbol bintang dalam jawaban Anda.";
            let finalPrompt = userMessage;

            // Deteksi cerdas apakah input pesan dari user berbentuk URL Website
            const isUrl = /^https?:\/\//i.test(userMessage) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(userMessage);

            if (isUrl) {
                let targetUrl = userMessage;
                if (!/^https?:\/\//i.test(targetUrl)) {
                    targetUrl = 'https://' + targetUrl;
                }

                console.log(`[Chatbot Speed] Menganalisis URL: ${targetUrl}`);
                let scoreStr = "Tidak bisa diukur";
                
                // Menarik data PageSpeed jika API Key tersedia
                if (PGSPEED_API_KEY) {
                    try {
                        const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${PGSPEED_API_KEY}`;
                        const psRes = await fetch(psUrl);
                        const psData = await psRes.json();
                        
                        if (psData?.lighthouseResult?.categories?.performance) {
                            const score = Math.round(psData.lighthouseResult.categories.performance.score * 100);
                            scoreStr = `${score} dari 100`;
                        }
                    } catch (err) {
                        scoreStr = "(Gagal menarik skor performa karena kendala jaringan)";
                    }
                }

                // Format instruksi analisis khusus URL untuk Groq
                finalPrompt = `User meminta analisis performa kecepatan pada URL: ${targetUrl}. Hasil skor Google PageSpeed adalah: ${scoreStr}. Berikan penjelasan yang ramah, ringkas (maksimal 3 kalimat), beritahu arti skor tersebut secara netral, dan berikan 1 tips SEO on-page yang tepat tanpa menggunakan simbol bintang.`;
            }

            // Eksekusi Panggilan AI Groq
            if (!GROQ_API_KEY) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reply: "Kunci akses API (GROQ_API_KEY) belum dikonfigurasi di server Netlify Anda." })
                };
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
                    max_tokens: 250 // Hemat Token & Mempercepat Loading Chat
                })
            });

            if (!groqRes.ok) throw new Error(`Groq API Error Status ${groqRes.status}`);

            const groqData = await groqRes.json();
            let replyText = groqData.choices[0].message.content;
            
            // Pengamanan Ganda: Bersihkan teks dari sisa-sisa simbol bintang (*)
            replyText = replyText.replace(/\*/g, '');

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reply: replyText })
            };
        }

        // Jika request body tidak dikenali
        return { 
            statusCode: 400, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ error: 'Payload tidak dikenali.' }) 
        };

    } catch (error) {
        console.error('[System Error]', error.message);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: "Sistem saya sedang sibuk memproses permintaan. Mohon coba tanyakan lagi beberapa saat." })
        };
    }
};
