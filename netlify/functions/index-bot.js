exports.handler = async function (event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Method tidak didukung." })
    };
  }

  try {
    const { message, instruction } = JSON.parse(event.body || "{}");
    const userMessage = String(message || "").trim();

    if (!userMessage) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "Pesan masih kosong." })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "OPENAI_API_KEY belum dipasang di Netlify Environment Variables." })
      };
    }

    const systemPrompt = [
      "Kamu adalah asisten AI resmi untuk portofolio Muhammad Faqih Al Rifai.",
      "Jawab dalam bahasa Indonesia yang natural, singkat, ramah, dan profesional.",
      "Bantu pengunjung memahami layanan SEO, digital marketing, pembuatan website, audit teknis, dan konsultasi.",
      "Jangan gunakan markdown tebal, jangan pakai simbol **, jangan menampilkan format yang berantakan.",
      "Bila pengunjung meminta kontak, arahkan ke WhatsApp +62 859-1482-19009 atau email faqihalrf@gmail.com.",
      instruction || ""
    ].join("\n");

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 550,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    });

    const data = await aiResponse.json();
    const reply = data?.choices?.[0]?.message?.content || "Maaf, AI belum mengirim jawaban. Coba ulangi pertanyaannya.";

    return {
      statusCode: aiResponse.ok ? 200 : aiResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Terjadi gangguan pada server AI. Silakan coba lagi beberapa saat lagi." })
    };
  }
};
