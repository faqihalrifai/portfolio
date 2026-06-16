const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
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
    const key = paragraph
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n\n').replace(/^(halo|hai|hi)\b[^.!?\n]*[.!?]\s*/i, '').trim();
}

function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-10).map((item) => {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = cleanText(item?.content || '').slice(0, 2200);
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
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function scoreFromLighthouse(data, category) {
  const score = data?.lighthouseResult?.categories?.[category]?.score;
  return typeof score === 'number' ? Math.round(score * 100) : null;
}

function auditDisplay(data, auditId) {
  const audit = data?.lighthouseResult?.audits?.[auditId];
  return audit?.displayValue || null;
}

function auditNumeric(data, auditId) {
  const audit = data?.lighthouseResult?.audits?.[auditId];
  return typeof audit?.numericValue === 'number' ? audit.numericValue : null;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function priorityForAudit(audit) {
  const score = typeof audit?.score === 'number' ? audit.score : 1;
  const savingsMs = Number(audit?.details?.overallSavingsMs || 0);
  const savingsBytes = Number(audit?.details?.overallSavingsBytes || 0);
  if (score < 0.5 || savingsMs >= 500 || savingsBytes >= 200000) return 'high';
  if (score < 0.8 || savingsMs >= 150 || savingsBytes >= 50000) return 'medium';
  return 'low';
}

function collectOpportunities(data) {
  const audits = Object.values(data?.lighthouseResult?.audits || {});
  return audits
    .filter((audit) => audit && audit.scoreDisplayMode === 'numeric' && audit.score !== null && audit.score < 0.9)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      displayValue: audit.displayValue || '',
      description: stripHtml(audit.description).slice(0, 260),
      priority: priorityForAudit(audit),
      score: Math.round((typeof audit.score === 'number' ? audit.score : 1) * 100),
      savingsMs: Math.round(Number(audit?.details?.overallSavingsMs || 0)),
      savingsBytes: Math.round(Number(audit?.details?.overallSavingsBytes || 0))
    }))
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority] || b.savingsMs - a.savingsMs || b.savingsBytes - a.savingsBytes;
    })
    .slice(0, 12);
}

function categoryFailures(data, categoryId) {
  const category = data?.lighthouseResult?.categories?.[categoryId];
  const audits = data?.lighthouseResult?.audits || {};
  if (!category?.auditRefs) return [];
  return category.auditRefs
    .filter((ref) => {
      const audit = audits[ref.id];
      return audit && typeof audit.score === 'number' && audit.score < 0.9 && audit.scoreDisplayMode !== 'notApplicable';
    })
    .map((ref) => {
      const audit = audits[ref.id];
      return {
        id: audit.id,
        title: audit.title,
        description: stripHtml(audit.description).slice(0, 220),
        displayValue: audit.displayValue || '',
        score: Math.round(audit.score * 100),
        priority: priorityForAudit(audit)
      };
    })
    .slice(0, 8);
}

function fieldMetric(data, scope, metricName) {
  const source = scope === 'origin' ? data?.originLoadingExperience?.metrics : data?.loadingExperience?.metrics;
  const metric = source?.[metricName];
  if (!metric) return null;
  return {
    percentile: metric.percentile ?? null,
    category: metric.category || null,
    distributions: Array.isArray(metric.distributions) ? metric.distributions : []
  };
}

function coreWebVitalsStatus(metrics) {
  const lcp = metrics.lcpMs;
  const cls = metrics.clsValue;
  const tbt = metrics.tbtMs;
  if (![lcp, cls, tbt].some((v) => typeof v === 'number')) return { status: 'Data terbatas', tone: 'unknown' };
  const good = (typeof lcp !== 'number' || lcp <= 2500)
    && (typeof cls !== 'number' || cls <= 0.1)
    && (typeof tbt !== 'number' || tbt <= 200);
  if (good) return { status: 'Metrik utama baik', tone: 'good' };
  const poor = (typeof lcp === 'number' && lcp > 4000)
    || (typeof cls === 'number' && cls > 0.25)
    || (typeof tbt === 'number' && tbt > 600);
  return poor ? { status: 'Butuh prioritas', tone: 'low' } : { status: 'Perlu perhatian', tone: 'medium' };
}

function buildResult(data, strategy) {
  const metrics = {
    fcp: auditDisplay(data, 'first-contentful-paint'),
    lcp: auditDisplay(data, 'largest-contentful-paint'),
    tbt: auditDisplay(data, 'total-blocking-time'),
    cls: auditDisplay(data, 'cumulative-layout-shift'),
    speedIndex: auditDisplay(data, 'speed-index'),
    ttfb: auditDisplay(data, 'server-response-time'),
    tti: auditDisplay(data, 'interactive'),
    lcpMs: auditNumeric(data, 'largest-contentful-paint'),
    tbtMs: auditNumeric(data, 'total-blocking-time'),
    clsValue: auditNumeric(data, 'cumulative-layout-shift')
  };

  const networkItems = data?.lighthouseResult?.audits?.['network-requests']?.details?.items || [];
  const longTaskItems = data?.lighthouseResult?.audits?.['long-tasks']?.details?.items || [];
  const domNumeric = auditNumeric(data, 'dom-size');
  const totalBytes = auditNumeric(data, 'total-byte-weight');

  return {
    strategy,
    finalUrl: data?.lighthouseResult?.finalDisplayedUrl || data?.id || '',
    fetchTime: data?.lighthouseResult?.fetchTime || null,
    scores: {
      performance: scoreFromLighthouse(data, 'performance'),
      accessibility: scoreFromLighthouse(data, 'accessibility'),
      bestPractices: scoreFromLighthouse(data, 'best-practices'),
      seo: scoreFromLighthouse(data, 'seo')
    },
    metrics,
    coreWebVitals: coreWebVitalsStatus(metrics),
    diagnostics: {
      totalByteWeight: auditDisplay(data, 'total-byte-weight') || formatBytes(totalBytes),
      requestCount: networkItems.length || null,
      domSize: auditDisplay(data, 'dom-size') || (domNumeric ? `${Math.round(domNumeric)} elemen` : null),
      longTasks: longTaskItems.length || 0,
      mainThreadWork: auditDisplay(data, 'mainthread-work-breakdown'),
      bootupTime: auditDisplay(data, 'bootup-time'),
      thirdParty: auditDisplay(data, 'third-party-summary')
    },
    fieldData: {
      page: {
        lcp: fieldMetric(data, 'page', 'LARGEST_CONTENTFUL_PAINT_MS'),
        cls: fieldMetric(data, 'page', 'CUMULATIVE_LAYOUT_SHIFT_SCORE'),
        inp: fieldMetric(data, 'page', 'INTERACTION_TO_NEXT_PAINT')
      },
      origin: {
        lcp: fieldMetric(data, 'origin', 'LARGEST_CONTENTFUL_PAINT_MS'),
        cls: fieldMetric(data, 'origin', 'CUMULATIVE_LAYOUT_SHIFT_SCORE'),
        inp: fieldMetric(data, 'origin', 'INTERACTION_TO_NEXT_PAINT')
      }
    },
    opportunities: collectOpportunities(data),
    categoryIssues: {
      accessibility: categoryFailures(data, 'accessibility'),
      bestPractices: categoryFailures(data, 'best-practices'),
      seo: categoryFailures(data, 'seo')
    }
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 50000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request-timeout')), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `request-failed-${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function runWebsiteAudit(url, strategy) {
  const key = process.env.PGSPEED_API_KEY || process.env.PAGESPEED_API_KEY || '';
  const params = new URLSearchParams({ url, strategy });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((category) => params.append('category', category));
  if (key) params.set('key', key);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await fetchJsonWithTimeout(endpoint, attempt === 0 ? 50000 : 35000);
      return buildResult(data, strategy);
    } catch (error) {
      lastError = error;
      const retryable = !error?.status || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  return {
    strategy,
    error: true,
    message: 'Data perangkat ini belum berhasil diambil.',
    scores: {},
    metrics: {},
    opportunities: [],
    categoryIssues: {}
  };
}

function buildOverview(results) {
  const valid = results.filter((item) => item && !item.error);
  const performances = valid.map((item) => item.scores.performance).filter(Number.isFinite);
  const lowestPerformance = performances.length ? Math.min(...performances) : null;
  const highPriorities = valid.flatMap((item) => item.opportunities || []).filter((item) => item.priority === 'high').length;
  let status = 'Data berhasil dihimpun';
  if (lowestPerformance !== null) {
    status = lowestPerformance >= 90 ? 'Kondisi sangat baik' : lowestPerformance >= 50 ? 'Kondisi cukup baik' : 'Perlu perbaikan utama';
  }
  return {
    status,
    priority: highPriorities ? `${highPriorities} prioritas tinggi` : 'Tidak ada isu kritis',
    lowestPerformance
  };
}

function deterministicSummary(summary) {
  const valid = summary.results.filter((item) => item && !item.error);
  if (!valid.length) {
    return 'Website belum berhasil dianalisis. Pastikan alamat dapat diakses publik dan tidak memblokir pemeriksaan otomatis.';
  }
  const mobile = valid.find((item) => item.strategy === 'mobile');
  const desktop = valid.find((item) => item.strategy === 'desktop');
  const opportunities = valid.flatMap((item) => item.opportunities || []);
  const unique = [];
  const seen = new Set();
  opportunities.forEach((item) => {
    const key = String(item.title || '').toLowerCase();
    if (key && !seen.has(key) && unique.length < 5) {
      seen.add(key);
      unique.push(item);
    }
  });

  const lines = [
    `Kondisi website: ${summary.overview.status}.`,
    mobile ? `Pengalaman seluler menjadi acuan utama dengan skor performa ${mobile.scores.performance ?? 'belum tersedia'}.` : '',
    desktop ? `Pada desktop, skor performa tercatat ${desktop.scores.performance ?? 'belum tersedia'}.` : ''
  ].filter(Boolean);

  if (unique.length) {
    lines.push('Urutan tindakan yang disarankan:');
    unique.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}${item.displayValue ? ` (${item.displayValue})` : ''}.`);
    });
  } else {
    lines.push('Tidak ditemukan hambatan besar pada audit yang tersedia. Fokus berikutnya adalah pemantauan rutin, kualitas konten, dan kestabilan konversi.');
  }
  lines.push('Dampak bisnis: perbaikan pada prioritas tertinggi biasanya membantu halaman terasa lebih cepat, mengurangi pengunjung yang keluar, dan memperkuat pengalaman pengguna di perangkat seluler.');
  return lines.join('\n');
}

async function callAssistant(messages, maxTokens = 1500) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return '';
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'assistant-request-failed');
  return dedupeText(data?.choices?.[0]?.message?.content || '');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ reply: 'Metode permintaan tidak didukung.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = cleanText(body.message || '');
    const history = sanitizeHistory(body.history);
    const requestedUrl = normalizeUrl(body.url || message);

    if (!message && !requestedUrl) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ reply: 'Tulis pertanyaan atau tempel alamat website yang ingin diperiksa.' })
      };
    }

    if (requestedUrl) {
      const results = await Promise.all([
        runWebsiteAudit(requestedUrl, 'mobile'),
        runWebsiteAudit(requestedUrl, 'desktop')
      ]);
      const validResults = results.filter((item) => !item.error);
      if (!validResults.length) {
        return {
          statusCode: 503,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            reply: 'Website belum berhasil diperiksa. Pastikan alamat dapat dibuka secara publik, tidak membutuhkan login, dan coba kembali beberapa saat lagi.',
            errorCode: 'ANALYSIS_UNAVAILABLE'
          })
        };
      }

      const summary = {
        url: requestedUrl,
        generatedAt: new Date().toISOString(),
        generatedLabel: 'Baru saja',
        results,
        overview: buildOverview(results)
      };

      const assistantReply = await callAssistant([
        {
          role: 'system',
          content: [
            "Kamu adalah Faqih's Assistant, analis website senior yang membantu pemilik bisnis dan tim teknis.",
            'Jawab dalam bahasa Indonesia yang profesional, jelas, dan sangat berguna tanpa sapaan pembuka.',
            'Jangan menyebut nama penyedia model, nama API, kunci, environment variable, atau teknologi internal yang digunakan.',
            'Jangan mengulang seluruh skor karena skor sudah tampil dalam kartu visual.',
            'Susun jawaban dengan bagian: Ringkasan Kondisi, Masalah Paling Berdampak, Rencana Perbaikan 7 Hari, Dampak Bisnis, dan Cara Memverifikasi.',
            'Berikan langkah konkret yang dapat dilakukan pemilik website maupun developer. Jelaskan istilah teknis secara singkat.',
            'Jangan menjanjikan peringkat Google atau skor 100. Jangan mengarang data di luar JSON.',
            'Gunakan paragraf pendek dan daftar bernomor biasa. Jangan memakai markdown tabel atau tanda pagar.'
          ].join(' ')
        },
        {
          role: 'user',
          content: `Analisis data audit website berikut secara menyeluruh. Prioritaskan mobile, Core Web Vitals, stabilitas layout, ukuran aset, JavaScript, aksesibilitas, praktik terbaik, dan SEO. Panjang 450-750 kata. Data: ${JSON.stringify(summary)}`
        }
      ], 1800).catch(() => '');

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          reply: assistantReply || deterministicSummary(summary),
          audit: summary
        })
      };
    }

    const reply = await callAssistant([
      {
        role: 'system',
        content: [
          "Kamu adalah Faqih's Assistant di website Muhammad Faqih Al Rifai.",
          'Jawab langsung dalam bahasa Indonesia yang profesional, natural, nyaman dibaca, dan relevan.',
          'Sapaan sudah ditampilkan sekali oleh antarmuka, jadi jangan memulai dengan Halo, Hai, atau sapaan lain.',
          'Gunakan konteks percakapan dan jangan mengulang jawaban sebelumnya.',
          'Jangan menyebut penyedia model, nama API, kunci, environment variable, atau konfigurasi internal.',
          'Bantu pengguna memahami SEO, performa website, UX, hosting, konten, analitik, dan strategi pengembangan website.',
          'Jika data tidak cukup, nyatakan batasannya dan ajukan satu pertanyaan yang paling penting.'
        ].join(' ')
      },
      ...history,
      { role: 'user', content: message }
    ], 1100).catch(() => '');

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reply: reply || 'Permintaan sudah diterima, tetapi jawaban belum dapat disusun saat ini. Silakan coba kembali beberapa saat lagi.'
      })
    };
  } catch (error) {
    console.error('assistant-function-error:', error?.message || error);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reply: 'Permintaan belum dapat diselesaikan saat ini. Pastikan alamat website dapat diakses publik, lalu coba kembali beberapa saat lagi.',
        errorCode: 'REQUEST_UNAVAILABLE'
      })
    };
  }
};
