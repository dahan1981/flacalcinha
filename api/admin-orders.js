import { timingSafeEqual } from "node:crypto";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_BASE_URL = "https://api.mercadopago.com";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function getHeader(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeCompare(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  const actualBuffer = Buffer.from(String(actual || ""), "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function toIsoDateStart(value) {
  if (!value) return "";
  return `${value}T00:00:00.000-03:00`;
}

function toIsoDateEnd(value) {
  if (!value) return "";
  return `${value}T23:59:59.999-03:00`;
}

function buildSearchUrl({ from, to, status, limit, offset }) {
  const url = new URL(`${API_BASE_URL}/v1/payments/search`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (from && to) {
    url.searchParams.set("sort", "date_created");
    url.searchParams.set("criteria", "desc");
    url.searchParams.set("range", "date_created");
    url.searchParams.set("begin_date", toIsoDateStart(from));
    url.searchParams.set("end_date", toIsoDateEnd(to));
  }

  if (status) {
    url.searchParams.set("status", status);
  }

  return url.toString();
}

async function fetchPaymentsPage(options) {
  const response = await fetch(buildSearchUrl(options), {
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message = result?.message || result?.error || `HTTP ${response.status}`;
    throw new Error(`Falha ao consultar Mercado Pago: ${message}`);
  }

  return {
    paging: result.paging || {},
    results: Array.isArray(result.results) ? result.results : []
  };
}

function sanitize(value) {
  return String(value ?? "").trim();
}

function normalizePayment(payment) {
  const metadata = payment.metadata || {};
  const payer = payment.payer || {};
  const additionalPayer = payment.additional_info?.payer || {};
  const items = Array.isArray(payment.additional_info?.items) ? payment.additional_info.items : [];
  const productItems = items.filter(item => String(item?.id || "").toLowerCase() !== "frete-jadlog");
  const firstName = sanitize(payer.first_name);
  const lastName = sanitize(payer.last_name);
  const payerName = [firstName, lastName].filter(Boolean).join(" ");
  const productSummary = sanitize(metadata.product_summary || metadata.product_name) ||
    productItems.map(item => `${sanitize(item.title)} x${Number(item.quantity || 0)}`).filter(Boolean).join(", ");

  return {
    id: payment.id || "",
    date_created: payment.date_created || "",
    date_approved: payment.date_approved || "",
    status: payment.status || "",
    status_detail: payment.status_detail || "",
    transaction_amount: Number(payment.transaction_amount || 0),
    total_paid_amount: Number(payment.transaction_details?.total_paid_amount || 0),
    payment_method: payment.payment_method_id || "",
    payment_type: payment.payment_type_id || "",
    external_reference: payment.external_reference || "",
    customer_name: sanitize(metadata.customer_name) || payerName || "Cliente",
    customer_email: sanitize(metadata.customer_email) || sanitize(payer.email),
    customer_phone:
      sanitize(metadata.customer_phone) ||
      sanitize(payer.phone?.number) ||
      sanitize(additionalPayer.phone?.number),
    product_name: productSummary || "Leque Flacalcinha",
    quantity: Number(metadata.quantity || productItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1),
    subtotal: Number(metadata.subtotal || 0),
    shipping_cost: Number(metadata.shipping_cost || 0),
    total: Number(metadata.total || payment.transaction_amount || 0),
    shipping_mode: sanitize(metadata.shipping_mode),
    shipping_service: sanitize(metadata.shipping_service),
    shipping_label: sanitize(metadata.shipping_label),
    address_cep: sanitize(metadata.address_cep),
    address_city: sanitize(metadata.address_city),
    address_state: sanitize(metadata.address_state)
  };
}

function buildSummary(rows) {
  return {
    orders: rows.length,
    fans: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    gross: rows.reduce((sum, row) => sum + Number(row.transaction_amount || row.total || 0), 0),
    products: rows.reduce((sum, row) => sum + Number(row.subtotal || 0), 0),
    shipping: rows.reduce((sum, row) => sum + Number(row.shipping_cost || 0), 0)
  };
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!ADMIN_PASSWORD || !MP_ACCESS_TOKEN) {
    res.status(500).json({ ok: false, error: "Admin panel not configured" });
    return;
  }

  const providedPassword = getHeader(req, "x-admin-password");
  if (!providedPassword || !safeCompare(ADMIN_PASSWORD, providedPassword)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const url = new URL(req.url || "/", "https://flacalcinha.vercel.app");
  const from = sanitize(url.searchParams.get("from"));
  const to = sanitize(url.searchParams.get("to"));
  const status = sanitize(url.searchParams.get("status") || "approved");
  const maxOrders = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
  const pageSize = 50;

  try {
    const rows = [];
    let offset = 0;

    while (rows.length < maxOrders) {
      const page = await fetchPaymentsPage({
        from,
        to,
        status,
        limit: Math.min(pageSize, maxOrders - rows.length),
        offset
      });

      if (!page.results.length) {
        break;
      }

      rows.push(...page.results.map(normalizePayment));
      offset += page.results.length;

      const total = Number(page.paging.total || 0);
      if (offset >= total) {
        break;
      }
    }

    res.status(200).json({
      ok: true,
      summary: buildSummary(rows),
      orders: rows
    });
  } catch {
    res.status(502).json({ ok: false, error: "Failed to load orders" });
  }
}
