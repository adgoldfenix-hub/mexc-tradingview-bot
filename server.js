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

// === Envoi d’un ordre Spot normal ===
async function placeSpotOrder(symbol, side, type, quantity, price = null) {
  const timestamp = Date.now();
  const params = {
    symbol,
    side,
    type,
    quantity,
    timestamp,
  };
  if (type === "LIMIT" && price) params.price = price;

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
    console.error("❌ Erreur API MEXC Spot:", err.response?.data || err.message);
    throw new Error(err.response?.data?.msg || err.message);
  }
}

// === Fermeture totale au MARKET avec vente de 99% ===
async function closeAllPositions(symbol) {
  try {
    const baseAsset = symbol.replace("USDT", "");
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const accountRes = await axios.get(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
      headers: { "X-MEXC-APIKEY": API_KEY },
      timeout: 10000,
    });

    const balances = accountRes.data.balances;
    const baseBalance = balances.find(b => b.asset === baseAsset)?.free || "0";
    
    // On prend 99% du solde
    const qtyToSell = parseFloat(baseBalance) * 0.99;
    
    if (qtyToSell <= 0) {
      throw new Error(`Aucun ${baseAsset} disponible à vendre`);
    }

    // Récupérer la précision
    const precision = await getQuantityPrecision(symbol);
    const qtyRounded = qtyToSell.toFixed(precision);  // Arrondir à la précision appropriée

    // Ordre MARKET SELL
    const params = {
      symbol,
      side: "SELL",
      type: "MARKET",
      quantity: qtyRounded,
      timestamp: Date.now(),
    };

    const sellQuery = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

    const sellSignature = sign(sellQuery);
    const sellFinalQuery = `${sellQuery}&signature=${sellSignature}`;

    const headers = {
      "X-MEXC-APIKEY": API_KEY,
      "Content-Type": "application/json",
    };

    console.log(`📤 Fermeture totale MARKET SELL pour ${symbol}: quantity=${qtyRounded} (solde original: ${baseBalance})`);

    const res = await axios.post(`${BASE_URL}/api/v3/order?${sellFinalQuery}`, null, {
      headers,
      timeout: 10000,
    });

    console.log("✅ Fermeture totale réussie :", JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (err) {
    console.error("❌ Erreur fermeture totale :", err.response?.data || err.message);
    throw new Error(err.response?.data?.msg || err.message);
  }
}

// === Fonction pour récupérer la précision ===
async function getQuantityPrecision(symbol) {
  const res = await axios.get(`${BASE_URL}/api/v3/exchangeInfo?symbol=${symbol}`);
  const filter = res.data.symbols[0].filters.find(f => f.filterType === "LOT_SIZE");
  return parseInt(filter.stepSize.split('.')[1]?.length || 0); // ex: 1 pour XRP
}


// === Health Check ===
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is alive" });
});

// === Webhook TradingView ===
app.post("/webhook", async (req, res) => {
  console.log("🚀 Signal reçu :", req.body);
  let { symbol, side, type, quantity, price } = req.body;

  if (!symbol || !side || !type || !quantity) {
    return res
      .status(400)
      .json({ status: "error", message: "symbol, side, type, quantity requis" });
  }

  side = side.toUpperCase();

  try {
    let result;

    // Détection close : SELL avec quantité > 1 → fermer tout au MARKET
    if (side === "SELL" && parseFloat(quantity) > 1) {
      result = await closeAllPositions(symbol);
    } else {
      result = await placeSpotOrder(symbol, side, type, quantity, price);
    }

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

// === Serveur ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur Spot MEXC prêt sur port ${PORT}`);
  console.log(`Health check disponible : /health`);
});