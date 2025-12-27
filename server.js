require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// === Clés API MEXC Spot ===
const API_KEY = process.env.MEXC_API_KEY;
const API_SECRET = process.env.MEXC_API_SECRET;

// === URL API Spot ===
const BASE_URL = "https://api.mexc.com";

// === Fonction de signature ===
function sign(queryString) {
  return crypto
    .createHmac("sha256", API_SECRET)
    .update(queryString)
    .digest("hex");
}

// === Envoi d’un ordre Spot ===
async function placeSpotOrder(symbol, side, type, quantity, price = null) {
  const timestamp = Date.now();

  const params = {
    symbol,
    side, // BUY ou SELL
    type, // MARKET ou LIMIT
    quantity,
    timestamp,
  };

  if (type === "LIMIT" && price) params.price = price;

  // Crée la query string triée
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const signature = sign(queryString);
  const finalQuery = `${queryString}&signature=${signature}`;

  const headers = {
    "X-MEXC-APIKEY": API_KEY,
    "Content-Type": "application/json",
  };

  console.log("📤 Payload envoyé à MEXC Spot:", finalQuery);

  try {
    const res = await axios.post(`${BASE_URL}/api/v3/order?${finalQuery}`, null, {
      headers,
      timeout: 10000,
    });

    console.log("✅ Réponse MEXC Spot :", JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (err) {
    console.error(
      "❌ Erreur API MEXC Spot:",
      err.response?.data || err.message
    );
    throw new Error(err.response?.data?.msg || err.message);
  }
}

// === Webhook TradingView ===
app.post("/webhook", async (req, res) => {
  console.log("🚀 Signal reçu :", req.body);
  const { symbol, side, type, quantity, price } = req.body;

  if (!symbol || !side || !type || !quantity) {
    return res
      .status(400)
      .json({ status: "error", message: "symbol, side, type, quantity requis" });
  }

  try {
    const result = await placeSpotOrder(symbol, side, type, quantity, price);
    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

// === Serveur ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur Spot MEXC prêt sur http://localhost:${PORT}`);
});
