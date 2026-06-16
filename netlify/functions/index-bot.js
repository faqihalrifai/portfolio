const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff'
};

function cleanText(value) {
  return String(value || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function dedupeText(value) {
  const paragraphs = cleanText(value).split(/\n{2,}/);
  const seen = new Set();
  return paragraphs.filter((paragraph) => {
    const key = paragraph.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n\n').replace(/^(halo|hai|hi)\b[^.!?\n]*[.!?]\s*/i, '').trim();
}

function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-8).map((item) => {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = cleanText(item?.content || '').slice(0, 1600);
    return content ? { role, content } : null;
  }).filter(Boolean);
}

function normalizeUrl(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/i);
  if (!match) return '';
  let candidate = match[0].replace(/[),.;]+$/g, '');
  if (candidate.startsWith('www.')) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function scoreFromLighthouse(result, category) {
  const score = result?.lighthouseResult?.categories?.[category]?.score;
  return typeof score === 'number' ? Math.round(score * 100) : null;
}

function metric(result, auditId) {
  const audit = result?.lighthouseResult?.audits?.[auditId];
  return audit?.displayValue || null;
}

function collectOpportunities(result) {
  const audits = Object.values(result?.lighthouseResult?.audits || {});
  return audits
    .filter((audit) => audit && audit.scoreDisplayMode === 'numeric' && audit.score !== null && audit.score < 0.9)
    .map((audit) => {
      const score = typeof audit.score === 'number' ? audit.score : 1;
      const savingsMs = Number(audit?.details?.overallSavingsMs || 0);
      const savingsBytes = Number(audit?.details?.overallSavingsBytes || 0);
      const priority = score < 0.5 || savingsMs >= 500 || savingsBytes >= 200000
        ? 'high'
        : score < 0.8 || savingsMs >= 150 || savingsBytes >= 50000
          ? 'medium'
          : 'low';
      return {
        title: audit.title,
        displayValue: audit.displayValue || '',
        description: String(audit.description || '').replace(/<[^>]+>/g, '').slice(0, 180),
        priority,
        score: Math.round(score * 100)
      };
    })
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
    .slice(0, 8);
}

async function runPageSpeed(url, strategy) {
  const apiKey = process.env.PGSPEED_API_KEY || process.env.PAGESPEED_API_KEY || '';
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance'
  });
  // URLSearchParams hanya menyimpan category terakhir jika set biasa, jadi append manual.
  params.delete('category');
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((cat) => params.append('category', cat));
  if (apiKey) params.set('key', apiKey);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const response = await fetch(endpoint, { method: 'GET' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `PageSpeed API error ${response.status}`;
    throw new Error(message);
  }
  return {
    strategy,
    finalUrl: data?.lighthouseResult?.finalDisplayedUrl || url,
    scores: {
      performance: scoreFromLighthouse(data, 'performance'),
      accessibility: scoreFromLighthouse(data, 'accessibility'),
      bestPractices: scoreFromLighthouse(data, 'best-practices'),
      seo: scoreFromLighthouse(data, 'seo')
    },
    metrics: {
      fcp: metric(data, 'first-contentful-paint'),
      lcp: metric(data, 'largest-contentful-paint'),
      tbt: metric(data, 'total-blocking-time'),
      cls: metric(data, 'cumulative-layout-shift'),
      speedIndex: metric(data, 'speed-index')
    },
    opportunities: collectOpportunities(data)
  };
}

async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return '';
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.22,
      max_tokens: 950,
      messages
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Groq API error ${response.status}`;
    throw new Error(message);
  }
  return dedupeText(data?.choices?.[0]?.message?.content || '');
}

function fallbackAudit(summary) {
  const mobile = summary.results.find((item) => item.strategy === 'mobile');
  const desktop = summary.results.find((item) => item.strategy === 'desktop');
  const lines = [];
  lines.push(`Laporan singkat untuk ${summary.url}`);
  if (mobile) lines.push(`Mobile: Performance ${mobile.scores.performance ?? '-'}, Accessibility ${mobile.scores.accessibility ?? '-'}, Best Practices ${mobile.scores.bestPractices ?? '-'}, SEO ${mobile.scores.seo ?? '-'}.`);
  if (desktop) lines.push(`Desktop: Performance ${desktop.scores.performance ?? '-'}, Accessibility ${desktop.scores.accessibility ?? '-'}, Best Practices ${desktop.scores.bestPractices ?? '-'}, SEO ${desktop.scores.seo ?? '-'}.`);
  if (mobile) lines.push(`Metrik utama mobile: LCP ${mobile.metrics.lcp || '-'}, TBT ${mobile.metrics.tbt || '-'}, CLS ${mobile.metrics.cls || '-'}.`);
  const opportunities = [...(mobile?.opportunities || []), ...(desktop?.opportunities || [])].slice(0, 5);
  if (opportunities.length) {
    lines.push('Prioritas perbaikan:');
    opportunities.forEach((item, index) => lines.push(`${index + 1}. ${item.title}${item.displayValue ? ` — ${item.displayValue}` : ''}`));
  }
  lines.push('Catatan: ringkasan ini memakai data PageSpeed. Untuk narasi AI yang lebih lengkap, pastikan GROQ_API_KEY aktif di Netlify.');
  return lines.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ reply: 'Method tidak didukung.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = cleanText(body.message || '');
    const history = sanitizeHistory(body.history);
    const requestedUrl = normalizeUrl(body.url || message);

    if (!message && !requestedUrl) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ reply: 'Silakan tulis pertanyaan atau tempel URL website yang ingin dianalisis.' }) };
    }

    if (requestedUrl) {
      const [mobile, desktop] = await Promise.all([
        runPageSpeed(requestedUrl, 'mobile'),
        runPageSpeed(requestedUrl, 'desktop')
      ]);
      const summary = { url: requestedUrl, generatedAt: new Date().toISOString(), results: [mobile, desktop] };
      const groqReply = await callGroq([
        {
          role: 'system',
          content: 'Kamu adalah Faqih\'s Assistant, analis performa website profesional milik Muhammad Faqih Al Rifai. Tulis bahasa Indonesia yang jelas untuk pengguna non-teknis. Jawab langsung tanpa sapaan pembuka. Gunakan paragraf pendek, jangan mengulang skor yang sudah tampil pada kartu, jangan mengulang paragraf, dan jangan memakai markdown bintang, tabel markdown, heading bertanda pagar, atau jargon tanpa penjelasan.'
        },
        {
          role: 'user',
          content: `Buat ringkasan pendamping untuk kartu laporan PageSpeed berikut. Fokus pada gambaran kondisi, tiga tindakan pertama yang paling berdampak, urutan prioritas, dan dampaknya bagi pengalaman pengguna serta bisnis. Jangan membuka dengan sapaan, jangan mengulang semua skor, dan jangan mengulang rekomendasi yang sama. Panjang 160-280 kata. Data JSON: ${JSON.stringify(summary)}`
        }
      ]);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ reply: groqReply || fallbackAudit(summary), audit: summary })
      };
    }

    const reply = await callGroq([
      {
        role: 'system',
        content: 'Kamu adalah Faqih\'s Assistant di website Muhammad Faqih Al Rifai. Jawab langsung dalam bahasa Indonesia yang profesional, natural, nyaman dibaca, dan relevan. Sapaan sudah ditampilkan sekali oleh antarmuka, jadi jangan memulai jawaban dengan Halo, Hai, atau sapaan lain. Gunakan konteks percakapan, jangan mengulang jawaban sebelumnya, jangan memakai markdown bintang, dan arahkan ke layanan SEO, pembuatan website, hosting, atau konsultasi hanya jika memang relevan.'
      },
      ...history,
      { role: 'user', content: message }
    ]);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ reply: reply || 'AI belum aktif. Pastikan GROQ_API_KEY sudah diisi di Netlify Environment Variables.' })
    };
  } catch (error) {
    console.error('index-bot error:', error);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ reply: 'Maaf, analisis website belum dapat diproses saat ini. Pastikan URL dapat diakses publik dan konfigurasi PageSpeed API di Netlify sudah aktif.', errorCode: 'AUDIT_UNAVAILABLE' })
    };
  }
};
