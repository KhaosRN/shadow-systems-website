require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const path = require("path");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = {
  "ticket-bot": { name: "Ticket Bot", price: 1500 },
  "moderation-bot": { name: "Moderation Bot", price: 2000 },
  "giveaway-bot": { name: "Giveaway Bot", price: 1000 },
  "review-bot": { name: "Review Bot", price: 1000 },
  "economy-casino-bot": { name: "Economy / Casino Bot", price: 1500 },
  "promo-wipe-scheduler-bot": { name: "Promo & Wipe List Scheduler Bot", price: 2500 },
  "invite-rewards-bot": { name: "Invite Rewards Bot", price: 1500 },
  "game-server-bot": { name: "Game Server / RCON Bot", price: 2500 }
};

/* =========================
   STRIPE WEBHOOK (MUST BE FIRST)
========================= */
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error("Webhook signature failed:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        await sendDiscordPurchaseLog(session);
      } catch (err) {
        console.error("Discord webhook error:", err);
      }
    }

    res.json({ received: true });
  }
);

/* =========================
   MIDDLEWARE (AFTER WEBHOOK)
========================= */
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart, tosAgreed, discordId, coupon } = req.body;

    if (!tosAgreed) {
      return res.status(400).json({ error: "TOS required" });
    }

    if (!discordId) {
      return res.status(400).json({ error: "Discord ID required" });
    }

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const line_items = [];

    for (const item of cart) {
      const product = PRODUCTS[item.id];
      if (!product) continue;

      const quantity = Math.max(1, Number(item.quantity) || 1);

      line_items.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name
          },
          unit_amount: product.price
        },
        quantity
      });
    }

    const cartSummary = cart
      .filter(i => PRODUCTS[i.id])
      .map(i => `${PRODUCTS[i.id].name} x${i.quantity || 1}`)
      .join(", ");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cancel.html`,
      metadata: {
        cart_summary: cartSummary,
        tos_agreed: String(tosAgreed),
        discord_id: discordId,
        coupon_used: coupon || "none"
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

/* =========================
   DISCORD LOG WEBHOOK
========================= */
async function sendDiscordPurchaseLog(session) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;

  const amount = ((session.amount_total || 0) / 100).toFixed(2);

  const payload = {
    username: "Shadow Systems Sales",
    embeds: [
      {
        title: "🛒 New Purchase",
        color: 0x39ff14,
        fields: [
          {
            name: "Email",
            value: session.customer_details?.email || "Unknown",
            inline: false
          },
          {
            name: "Discord ID",
            value: session.metadata?.discord_id || "None",
            inline: false
          },
          {
            name: "Items",
            value: session.metadata?.cart_summary || "None",
            inline: false
          },
          {
            name: "Coupon",
            value: session.metadata?.coupon_used || "None",
            inline: true
          },
          {
            name: "Total",
            value: `$${amount}`,
            inline: true
          },
          {
            name: "Session ID",
            value: session.id,
            inline: false
          }
        ],
        timestamp: new Date().toISOString()
      }
    ]
  };

  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    console.error("Discord log failed:", await res.text());
  }
}

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Shadow Systems running on ${SITE_URL}`);
});