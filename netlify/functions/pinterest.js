const fetch = require('node-fetch');

// Fungsi untuk mengambil data pin/proyek dari Pinterest
exports.handler = async function(event, context) {
  const PINTEREST_TOKEN = process.env.PINTEREST_ACCESS_TOKEN;

  try {
    // Pinterest API v5 - Mengambil daftar pin milik user (atau board tertentu)
    // Catatan: Endpoint ini bisa disesuaikan dengan board_id spesifik Anda
    const response = await fetch('https://api.pinterest.com/v5/pins', {
      headers: {
        'Authorization': `Bearer ${PINTEREST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.message }) };
    }

    // Hanya kirim 5 item teratas ke frontend agar tampilan rapi
    const limitedData = data.items.slice(0, 5);

    return {
      statusCode: 200,
      body: JSON.stringify(limitedData)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gagal mengambil data Pinterest" })
    };
  }
};