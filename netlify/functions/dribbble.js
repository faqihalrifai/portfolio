const fetch = require('node-fetch');

// Fungsi untuk mengambil shot desain dari Dribbble
exports.handler = async function(event, context) {
  // Gunakan Access Token yang Anda miliki
  const DRIBBBLE_TOKEN = process.env.DRIBBBLE_ACCESS_TOKEN; 

  try {
    // Mengambil shots (desain) terbaru
    const response = await fetch('https://api.dribbble.com/v2/user/shots', {
      headers: {
        'Authorization': `Bearer ${DRIBBBLE_TOKEN}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: "Dribbble API Error" }) };
    }

    // Ambil 7 desain sesuai permintaan untuk slider
    const limitedShots = data.slice(0, 7);

    return {
      statusCode: 200,
      body: JSON.stringify(limitedShots)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gagal memuat inspirasi Dribbble" })
    };
  }
};