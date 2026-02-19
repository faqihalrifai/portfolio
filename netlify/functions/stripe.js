const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Fungsi untuk membuat sesi pembayaran (Checkout) profesional
exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { serviceName, price } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'idr',
            product_data: {
              name: serviceName,
            },
            unit_amount: price, // Harga dalam satuan terkecil (misal 1000000 untuk 1jt)
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://faqihalrf.netlify.app/success',
      cancel_url: 'https://faqihalrf.netlify.app/cancel',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};