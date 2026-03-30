const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const DEFAULT_SITE_URL =
  process.env.APP_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://flacalcinha.vercel.app");

function getHeader(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
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

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function getBaseUrl(req) {
  const forwardedProto = getHeader(req, "x-forwarded-proto") || "https";
  const forwardedHost = getHeader(req, "x-forwarded-host") || getHeader(req, "host");

  if (!forwardedHost) {
    return DEFAULT_SITE_URL;
  }

  return `${forwardedProto}://${forwardedHost}`;
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function splitName(fullName) {
  const parts = sanitizeString(fullName).split(/\s+/).filter(Boolean);
  return {
    name: parts[0] || "",
    surname: parts.slice(1).join(" ") || "Cliente"
  };
}

function validatePayload(payload) {
  const customer = payload?.customer || {};
  const address = payload?.address || {};
  const order = payload?.order || {};
  const privacy = payload?.privacy || {};

  if (!customer.name || !customer.email || !customer.phone) {
    return "Missing customer fields";
  }

  if (!address.cep || !address.street || !address.number || !address.district || !address.city || !address.state) {
    return "Missing address fields";
  }

  if (!order.productName || !order.quantity || !order.unitPrice) {
    return "Missing order fields";
  }

  if (!privacy.checkoutPrivacyConsent || !privacy.checkoutEmailConsent) {
    return "Missing privacy consents";
  }

  return "";
}

function buildExternalReference() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FLC-${Date.now()}-${random}`;
}

function buildPreference(body, req) {
  const customer = body.customer;
  const address = body.address;
  const order = body.order;
  const quantity = Number(order.quantity);
  const unitPrice = Number(order.unitPrice);
  const subtotal = Number(order.subtotal || quantity * unitPrice);
  const preferredPaymentMethod = body.preferredPaymentMethod === "card" ? "card" : "pix";
  const externalReference = buildExternalReference();
  const baseUrl = getBaseUrl(req);
  const { name, surname } = splitName(customer.name);

  return {
    preference: {
      items: [
        {
          id: sanitizeString(order.productName).toLowerCase().replaceAll(/\s+/g, "-"),
          title: sanitizeString(order.productName),
          description: "Leque oficial da Flacalcinha",
          quantity,
          currency_id: "BRL",
          unit_price: unitPrice
        }
      ],
      payer: {
        name,
        surname,
        email: sanitizeString(customer.email),
        phone: {
          number: sanitizeString(customer.phone)
        },
        address: {
          zip_code: sanitizeString(address.cep),
          street_name: sanitizeString(address.street),
          street_number: sanitizeString(address.number)
        }
      },
      back_urls: {
        success: `${baseUrl}/?checkout=approved`,
        pending: `${baseUrl}/?checkout=pending`,
        failure: `${baseUrl}/?checkout=failure`
      },
      notification_url: `${baseUrl}/api/payment-webhook`,
      auto_return: "approved",
      external_reference: externalReference,
      statement_descriptor: "FLACALCINHA",
      payment_methods: {
        installments: 12
      },
      metadata: {
        customer_name: sanitizeString(customer.name),
        product_name: sanitizeString(order.productName),
        quantity: String(quantity),
        subtotal: String(subtotal),
        address_cep: sanitizeString(address.cep),
        address_city: sanitizeString(address.city),
        address_state: sanitizeString(address.state).toUpperCase(),
        shipping_status: "pending_shipping_integration",
        preferred_payment_method: preferredPaymentMethod
      }
    },
    externalReference
  };
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!MP_ACCESS_TOKEN) {
    res.status(500).json({ ok: false, error: "MP_ACCESS_TOKEN not configured" });
    return;
  }

  const body = parseJsonBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }

  const validationError = validatePayload(body);
  if (validationError) {
    res.status(400).json({ ok: false, error: validationError });
    return;
  }

  const { preference, externalReference } = buildPreference(body, req);

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `${externalReference}-${Date.now()}`
      },
      body: JSON.stringify(preference)
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.init_point) {
      const apiError = result?.message || result?.error || "Failed to create payment preference";
      throw new Error(apiError);
    }

    res.status(200).json({
      ok: true,
      checkoutUrl: result.init_point,
      preferenceId: result.id,
      externalReference
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
