const JADLOG_TOKEN = process.env.JADLOG_TOKEN;
const JADLOG_USER = process.env.JADLOG_USER;
const JADLOG_CLIENT_CODE = process.env.JADLOG_CLIENT_CODE;
const JADLOG_ACCOUNT = process.env.JADLOG_ACCOUNT || process.env.JADLOG_CLIENT_CODE || "";
const JADLOG_CONTRACT = process.env.JADLOG_CONTRACT || null;
const JADLOG_ORIGIN_ZIP = process.env.JADLOG_ORIGIN_ZIP || "28681624";
const JADLOG_MODALIDADE = Number(process.env.JADLOG_MODALIDADE || 3);
const JADLOG_PACKAGE_WEIGHT_KG = Number(process.env.JADLOG_PACKAGE_WEIGHT_KG || 0.2);

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function parseJsonBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  return null;
}

function getDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function normalizeError(result) {
  return (
    result?.frete?.[0]?.erro?.descricao ||
    result?.erro?.descricao ||
    result?.error?.descricao ||
    result?.message ||
    result?.error ||
    "Nao foi possivel calcular o frete na Jadlog."
  );
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!JADLOG_TOKEN || !JADLOG_USER || !JADLOG_CLIENT_CODE || !JADLOG_ORIGIN_ZIP) {
    res.status(500).json({ ok: false, error: "Jadlog environment not configured" });
    return;
  }

  const body = parseJsonBody(req);
  const destinationZip = getDigits(body?.cep);
  const quantity = Math.max(1, Math.min(50, Number(body?.quantity || 1)));

  if (destinationZip.length !== 8) {
    res.status(400).json({ ok: false, error: "CEP invalido para cotacao" });
    return;
  }

  const subtotal = quantity * 45;
  const totalWeight = Number((JADLOG_PACKAGE_WEIGHT_KG * quantity).toFixed(3));
  const payload = {
    frete: [
      {
        cepori: getDigits(JADLOG_ORIGIN_ZIP),
        cepdes: destinationZip,
        frap: "N",
        peso: totalWeight,
        cnpj: getDigits(JADLOG_USER),
        conta: String(JADLOG_ACCOUNT || ""),
        contrato: JADLOG_CONTRACT ? String(JADLOG_CONTRACT) : null,
        modalidade: JADLOG_MODALIDADE,
        tpentrega: "D",
        tpseguro: "N",
        vldeclarado: subtotal,
        vlcoleta: 0
      }
    ]
  };

  try {
    const response = await fetch("https://www.jadlog.com.br/embarcador/api/frete/valor", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JADLOG_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => null);
    const quote = result?.frete?.[0];
    const value = Number(quote?.vltotal);

    if (!response.ok || !quote || Number.isNaN(value)) {
      throw new Error(normalizeError(result));
    }

    const days = Number(quote?.prazo || 0) || null;
    const label = `Jadlog - ${formatCurrency(value)}${days ? ` - ${days} ${days === 1 ? "dia util" : "dias uteis"}` : ""}`;

    res.status(200).json({
      ok: true,
      shipping: {
        service: "Jadlog",
        cost: value,
        days,
        label
      }
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao consultar a Jadlog"
    });
  }
}
