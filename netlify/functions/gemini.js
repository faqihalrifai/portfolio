const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Hanya izinkan metode POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { prompt } = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY; // Mengambil kunci dari Brankas Netlify

    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "API Key not configured" }) };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Jawablah sebagai konsultan digital marketing profesional, singkat, dan solutif: " + prompt }] }]
      })
    });

    const data = await response.json();
    
    // Cek jika ada error dari Google
    if (data.error) {
       return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya sedang memproses banyak data. Coba lagi.";

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: reply })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" })
    };
  }
};