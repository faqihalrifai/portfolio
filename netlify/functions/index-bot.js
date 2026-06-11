exports.handler = async function(event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  const json = (statusCode, body) => ({
    statusCode,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return json(405, { reply: "Method tidak didukung. Gunakan POST." });

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return json(400, { reply: "Format request tidak valid." });
  }

  const clean = (value) => String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`{1,3}/g, "")
    .replace(/#{1,6}\s*/g, "")
    .trim();

  try {
    // MODE 1: Google Indexing API. Kirim { "url": "https://..." } tanpa message.
    if (body.url && !body.message) {
      const targetUrl = String(body.url || "").trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        return json(400, { reply: "URL harus diawali http:// atau https://." });
      }

      let google;
      try {
        google = require("googleapis").google;
      } catch (_) {
        return json(500, { reply: "Dependency googleapis belum tersedia. Pastikan package.json ikut ter-deploy." });
      }

      let clientEmail = process.env.GSC_CLIENT_EMAIL || "";
      let privateKey = process.env.GSC_PRIVATE_KEY || "";

      // Tetap support GOOGLE_CREDENTIALS JSON kalau env itu sudah kamu isi.
      if ((!clientEmail || !privateKey) && process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        clientEmail = credentials.client_email || "";
        privateKey = credentials.private_key || "";
      }

      if (!clientEmail || !privateKey) {
        return json(500, { reply: "Credential Google belum lengkap. Isi GOOGLE_CREDENTIALS atau GSC_CLIENT_EMAIL + GSC_PRIVATE_KEY di Netlify." });
      }

      privateKey = privateKey.replace(/\\n/g, "\n");

      const jwtClient = new google.auth.JWT(
        clientEmail,
        null,
        privateKey,
        ["https://www.googleapis.com/auth/indexing"],
        null
      );

      await jwtClient.authorize();
      const response = await google.indexing({ version: "v3", auth: jwtClient }).urlNotifications.publish({
        requestBody: { url: targetUrl, type: "URL_UPDATED" }
      });

      return json(200, {
        message: "Instruksi indexing diterima Google.",
        url: targetUrl,
        details: response.data
      });
    }

    // MODE 2: Chatbot AI. Kirim { "message": "..." }.
    const userMessage = clean(body.message);
    if (!userMessage) return json(400, { reply: "Pesan masih kosong." });

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const PGSPEED_API_KEY = process.env.PGSPEED_API_KEY;
    const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    if (!GROQ_API_KEY) {
      return json(500, { reply: "GROQ_API_KEY belum dipasang di Netlify Environment Variables." });
    }

    const isUrl = /^https?:\/\//i.test(userMessage) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(userMessage);
    let finalPrompt = userMessage;

    if (isUrl) {
      let targetUrl = userMessage;
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

      let mobileScore = "belum tersedia";
      let desktopScore = "belum tersedia";

      if (PGSPEED_API_KEY) {
        const getScore = async (strategy) => {
          try {
            const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=${strategy}&category=performance&key=${PGSPEED_API_KEY}`;
            const res = await fetch(psUrl);
            const data = await res.json();
            const score = data?.lighthouseResult?.categories?.performance?.score;
            return typeof score === "number" ? `${Math.round(score * 100)}/100` : "belum tersedia";
          } catch (_) {
            return "gagal diukur";
          }
        };

        [mobileScore, desktopScore] = await Promise.all([getScore("mobile"), getScore("desktop")]);
      }

      finalPrompt = `User meminta analisis singkat untuk URL ${targetUrl}. Skor PageSpeed mobile: ${mobileScore}. Skor PageSpeed desktop: ${desktopScore}. Jawab dalam bahasa Indonesia, maksimal 4 kalimat pendek, beri arti skor secara netral dan 2 saran prioritas. Jangan gunakan markdown, bullet simbol bintang, atau format tebal.`;
    }

    const systemPrompt = [
      "Anda adalah asisten AI resmi milik Muhammad Faqih Al Rifai, Digital Marketer dan SEO Specialist.",
      "Jawab selalu dalam bahasa Indonesia yang natural, ramah, profesional, rapi, dan solutif.",
      "Jawaban maksimal 3 sampai 4 kalimat pendek kecuali user meminta detail.",
      "Jangan gunakan simbol bintang, markdown tebal, heading markdown, atau format yang berantakan.",
      "Bila pengunjung bertanya layanan, arahkan ke SEO, digital marketing, website, audit teknis, dan konsultasi.",
      clean(body.instruction)
    ].filter(Boolean).join("\n");

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.45,
        max_tokens: 320,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalPrompt }
        ]
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) {
      return json(groqRes.status, { reply: "AI sedang belum bisa menjawab dari server. Cek GROQ_API_KEY dan GROQ_MODEL di Netlify." });
    }

    const reply = clean(groqData?.choices?.[0]?.message?.content || "Maaf, AI belum mengirim jawaban. Coba ulangi pertanyaannya.");
    return json(200, { reply });
  } catch (error) {
    console.error("[Netlify Function Error]", error);
    return json(500, { reply: "Sistem AI sedang sibuk. Mohon coba lagi beberapa saat." });
  }
};
