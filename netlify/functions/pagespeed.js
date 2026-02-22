const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // 1. Hanya izinkan metode POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Ambil URL website yang mau di-audit dari frontend
        const { url } = JSON.parse(event.body);
        
        // 3. Ambil API Key dari Brankas Netlify
        const apiKey = process.env.PAGESPEED_API_KEY;

        if (!url) {
            return { statusCode: 400, body: JSON.stringify({ error: "URL website harus diisi" }) };
        }

        if (!apiKey) {
            return { statusCode: 500, body: JSON.stringify({ error: "API Key PageSpeed belum dikonfigurasi di Netlify" }) };
        }

        // 4. Panggil Google PageSpeed Insights API (Strategi Mobile)
        const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=mobile`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.error) {
            return { statusCode: 400, body: JSON.stringify({ error: data.error.message }) };
        }

        // 5. Ekstraksi Data Penting (Lighthouse Metrics)
        const performanceScore = Math.round(data.lighthouseResult.categories.performance.score * 100);
        const metrics = {
            score: performanceScore,
            lcp: data.lighthouseResult.audits['largest-contentful-paint'].displayValue, // Kecepatan muat konten terbesar
            cls: data.lighthouseResult.audits['cumulative-layout-shift'].displayValue, // Stabilitas visual
            fcp: data.lighthouseResult.audits['first-contentful-paint'].displayValue,  // Kecepatan muncul konten pertama
            tti: data.lighthouseResult.audits['interactive'].displayValue              // Waktu sampai bisa diklik
        };

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify(metrics)
        };

    } catch (error) {
        console.error("Audit Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Gagal melakukan audit website. Pastikan URL benar." })
        };
    }
};
