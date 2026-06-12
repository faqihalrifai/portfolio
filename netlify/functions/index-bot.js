const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function cleanText(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractUrl(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/https?:\/\/[^\s<>()]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>()]*)?/);
  if (!match) return '';
  let url = match[0].replace(/[.,;!?)]$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function runPageSpeed(targetUrl, strategy) {
  const apiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  apiUrl.searchParams.set('url', targetUrl);
  apiUrl.searchParams.set('strategy', strategy);
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach(category => apiUrl.searchParams.append('category', category));
  if (process.env.PGSPEED_API_KEY) apiUrl.searchParams.set('key', process.env.PGSPEED_API_KEY);

  const res = await fetchWithTimeout(apiUrl.toString(), {}, 28000);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PageSpeed ${strategy} gagal (${res.status}). ${detail.slice(0, 160)}`);
  }
  const data = await res.json();
  const lh = data.lighthouseResult || {};
  const categories = lh.categories || {};
  const audits = lh.audits || {};

  const score = key => categories[key] && typeof categories[key].score === 'number' ? Math.round(categories[key].score * 100) : null;
  const display = key => audits[key] ? audits[key].displayValue || audits[key].numericValue || null : null;
  const title = key => audits[key] ? audits[key].title || key : key;
  const auditScore = key => audits[key] && typeof audits[key].score === 'number' ? Math.round(audits[key].score * 100) : null;

  const importantAudits = [
    'largest-contentful-paint',
    'first-contentful-paint',
    'speed-index',
    'total-blocking-time',
    'cumulative-layout-shift',
    'render-blocking-resources',
    'unused-javascript',
    'uses-optimized-images',
    'modern-image-formats',
    'uses-long-cache-ttl',
    'server-response-time'
  ].map(id => ({ id, title: title(id), score: auditScore(id), value: display(id) }))
   .filter(item => item.value !== null || item.score !== null);

  return {
    strategy,
    finalUrl: lh.finalUrl || targetUrl,
    fetchTime: lh.fetchTime,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo')
    },
    metrics: importantAudits
  };
}

async function askGroq(messages, temperature = 0.35) {
  if (!process.env.GROQ_API_KEY) {
    return 'AI belum aktif karena GROQ_API_KEY belum dipasang di Netlify Environment Variables.';
  }
  const res = await fetchWithTimeout(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature,
      max_tokens: 1200
    })
  }, 28000);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq API gagal (${res.status}). ${detail.slice(0, 180)}`);
  }
  const data = await res.json();
  return cleanText(data.choices?.[0]?.message?.content || '');
}

function buildAuditPrompt(targetUrl, results, userMessage) {
  return [
    {
      role: 'system',
      content: 'Kamu adalah AI assistant portfolio Muhammad Faqih Al Rifai. Jawab dalam bahasa Indonesia yang rapi, singkat, profesional, mudah dipahami pemilik website. Jangan gunakan markdown bintang tebal. Jangan pakai simbol **. Fokus pada tindakan praktis.'
    },
    {
      role: 'user',
      content: `Buat laporan analisis website dari data PageSpeed berikut. URL: ${targetUrl}\nPesan user: ${userMessage}\nData JSON: ${JSON.stringify(results)}\n\nFormat jawaban:\n1. Ringkasan singkat\n2. Skor Mobile dan Desktop\n3. Masalah prioritas tinggi\n4. Saran perbaikan teknis yang mudah dilakukan\n5. Kesimpulan apakah website sudah aman atau butuh optimasi\nGunakan bahasa natural, tanpa klaim berlebihan, dan jangan menyuruh user cek manual kecuali memang perlu.`
    }
  ];
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { reply: 'Method tidak didukung.' });

  try {
    const body = JSON.parse(event.body || '{}');
    const message = String(body.message || '').trim();
    const explicitUrl = body.url ? extractUrl(body.url) : '';
    const targetUrl = explicitUrl || extractUrl(message);

    if (!message && !targetUrl) {
      return json(400, { reply: 'Silakan tulis pertanyaan atau kirim URL website yang ingin dianalisis.' });
    }

    if (targetUrl) {
      const settled = await Promise.allSettled([
        runPageSpeed(targetUrl, 'mobile'),
        runPageSpeed(targetUrl, 'desktop')
      ]);
      const results = settled.map(item => item.status === 'fulfilled' ? item.value : { error: item.reason.message });
      const hasValid = results.some(item => item && !item.error);
      if (!hasValid) {
        return json(502, { reply: `Maaf, PageSpeed belum berhasil membaca URL tersebut. Pastikan URL publik bisa diakses tanpa login. Detail: ${results.map(r => r.error).filter(Boolean).join(' | ')}` });
      }
      const reply = await askGroq(buildAuditPrompt(targetUrl, results, message), 0.25);
      return json(200, { ok: true, mode: 'url-audit', url: targetUrl, pagespeed: results, reply });
    }

    const reply = await askGroq([
      {
        role: 'system',
        content: 'Kamu adalah AI assistant portfolio Muhammad Faqih Al Rifai. Jawab dalam bahasa Indonesia yang natural, ramah, profesional, ringkas, tanpa markdown bintang, tanpa simbol **. Bantu user memahami layanan SEO, website, digital marketing, portofolio, dan cara menghubungi Faqih.'
      },
      { role: 'user', content: message }
    ], 0.45);

    return json(200, { ok: true, mode: 'chat', reply });
  } catch (error) {
    console.error('index-bot error:', error);
    return json(500, { reply: `Maaf, AI sedang mengalami kendala teknis: ${cleanText(error.message)}` });
  }
};
