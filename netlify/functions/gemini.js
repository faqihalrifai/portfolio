const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // 1. Keamanan: Hanya izinkan metode POST
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        // 2. Ambil prompt dari body request
        const { prompt } = JSON.parse(event.body);
        
        // 3. Ambil API Key dari Environment Variable Netlify (Brankas)
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return { 
                statusCode: 500, 
                body: JSON.stringify({ error: "Konfigurasi API Key di Netlify belum ada." }) 
            };
        }

        // 4. URL API Gemini v1beta
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // 5. Panggil API Google Gemini
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ 
                    parts: [{ 
                        text: "Kamu adalah konsultan bisnis dan digital marketing profesional. Jawablah pertanyaan berikut dengan taktis, solutif, dan singkat: " + prompt 
                    }] 
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 800,
                }
            })
        });

        const data = await response.json();

        // 6. Cek jika Google memberikan error
        if (data.error) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: data.error.message }) 
            };
        }

        // 7. Ambil teks jawaban
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak mendapatkan jawaban. Silakan coba lagi.";

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                // CORS headers agar bisa dipanggil dari frontend kamu
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ reply: reply })
        };

    } catch (error) {
        console.error("Error Function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Terjadi kesalahan pada server backend." })
        };
    }
};
