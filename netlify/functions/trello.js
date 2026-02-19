const fetch = require('node-fetch');

// Fungsi untuk mengecek progres pengerjaan proyek klien di Trello
exports.handler = async function(event, context) {
  const { TRELLO_KEY, TRELLO_TOKEN } = process.env;
  const BOARD_ID = process.env.TRELLO_BOARD_ID; // Masukkan ID Board pengerjaan Anda di Env Netlify

  try {
    // Mengambil daftar card dari board spesifik
    const response = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const cards = await response.json();

    // Mapping status berdasarkan nama list/kolom di Trello Anda
    const progress = cards.map(card => ({
      name: card.name,
      status: card.labels.length > 0 ? card.labels[0].name : "In Queue",
      lastUpdate: card.dateLastActivity
    }));

    return {
      statusCode: 200,
      body: JSON.stringify(progress)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gagal terhubung ke Trello" })
    };
  }
};