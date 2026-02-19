const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { url } = JSON.parse(event.body);
    const apiKey = process.env.PAGESPEED_API_KEY; // Mengambil kunci dari Brankas Netlify

    if (!url || !apiKey) {
      return { statusCode: 400, body: JSON.stringify({ error: "URL or API Key missing" }) };
    }

    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=mobile`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.error) {
      return { statusCode: 400, body: JSON.stringify({ error: data.error.message }) };
    }

    // Ambil data penting saja
    const score = Math.round(data.lighthouseResult.categories.performance.score * 100);
    const lcp = data.lighthouseResult.audits['largest-contentful-paint'].displayValue;
    const cls = data.lighthouseResult.audits['cumulative-layout-shift'].displayValue;

    return {
      statusCode: 200,
      body: JSON.stringify({ score, lcp, cls })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to audit website" })
    };
  }
};