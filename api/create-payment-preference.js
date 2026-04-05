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

function sendSafeError(res, status, message) {
  res.status(status).json({ ok: false, error: message });
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
  const deliveryMode = sanitizeString(order.deliveryMode || "delivery");
  const shippingCost = Number(order.shippingCost || 0);
  const items = Array.isArray(order.items) ? order.items : [];
  const validItems = items.filter(item => sanitizeString(item?.productName) && Number(item?.quantity || 0) > 0);

  if (!customer.name || !customer.email || !customer.phone) {
    return "Preencha nome, e-mail e numero antes de gerar o checkout.";
  }

  if (!address.cep || !address.street || !address.number || !address.district || !address.city || !address.state) {
    return "Preencha CEP, rua, numero, bairro, cidade e estado antes de gerar o checkout.";
  }

  if (!validItems.length || !Number(order.quantity || 0)) {
    return "Nao foi possivel montar o pedido.";
  }

  if (
    !order.shippingLabel ||
    (deliveryMode !== "pickup" && (Number.isNaN(shippingCost) || shippingCost < 0))
  ) {
    return "Calcule o frete ou escolha retirada antes de abrir o checkout.";
  }

  if (!privacy.checkoutPrivacyConsent || !privacy.checkoutEmailConsent) {
    return "Marque os dois consentimentos de privacidade e e-mail antes de abrir o checkout.";
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
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const normalizedItems = orderItems
    .map(item => {
      const title = sanitizeString(item.productName);
      const quantity = Math.max(0, Number(item.quantity || 0));
      const unitPrice = Number(item.unitPrice || 0);

      if (!title || !quantity || Number.isNaN(unitPrice) || unitPrice <= 0) {
        return null;
      }

      return {
        productName: title,
        quantity,
        unitPrice,
        subtotal: Number(item.subtotal || quantity * unitPrice)
      };
    })
    .filter(Boolean);
  const quantity = normalizedItems.reduce((total, item) => total + item.quantity, 0);
  const subtotal = Number(order.subtotal || normalizedItems.reduce((total, item) => total + item.subtotal, 0));
  const shippingCost = Math.max(0, Number(order.shippingCost || 0));
  const total = Number(order.total || subtotal + shippingCost);
  const deliveryMode = sanitizeString(order.deliveryMode || "delivery") === "pickup" ? "pickup" : "delivery";
  const shippingService = sanitizeString(order.shippingService || (deliveryMode === "pickup" ? "retirada" : "jadlog"));
  const shippingLabel = sanitizeString(order.shippingLabel || "");
  const productSummary = sanitizeString(order.productSummary || normalizedItems.map(item => `${item.productName} x${item.quantity}`).join(", "));
  const preferredPaymentMethod = body.preferredPaymentMethod === "card" ? "card" : "pix";
  const externalReference = buildExternalReference();
  const baseUrl = getBaseUrl(req);
  const { name, surname } = splitName(customer.name);
  const paymentMethods =
    preferredPaymentMethod === "pix"
      ? {
          excluded_payment_types: [
            { id: "credit_card" },
            { id: "debit_card" },
            { id: "ticket" }
          ],
          installments: 1
        }
      : {
          excluded_payment_types: [
            { id: "bank_transfer" },
            { id: "ticket" }
          ],
          installments: 12
        };

  const items = normalizedItems.map(item => ({
      id: sanitizeString(item.productName).toLowerCase().replaceAll(/\s+/g, "-"),
      title: sanitizeString(item.productName),
      description: "Leque oficial da Flacalcinha",
      quantity: item.quantity,
      currency_id: "BRL",
      unit_price: item.unitPrice
    }));

  if (deliveryMode === "delivery" && shippingCost > 0) {
    items.push({
      id: "frete-jadlog",
      title: "Frete Jadlog",
      description: shippingLabel || "Frete calculado para o pedido",
      quantity: 1,
      currency_id: "BRL",
      unit_price: shippingCost
    });
  }

  return {
    preference: {
      items,
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
      payment_methods: paymentMethods,
      metadata: {
        customer_name: sanitizeString(customer.name),
        customer_email: sanitizeString(customer.email),
        product_name: productSummary,
        product_summary: productSummary,
        quantity: String(quantity),
        subtotal: String(subtotal),
        total: String(total),
        address_cep: sanitizeString(address.cep),
        shipping_cost: String(shippingCost),
        shipping_label: shippingLabel,
        shipping_mode: deliveryMode,
        shipping_service: shippingService,
        shipping_deadline_days: sanitizeString(order.deliveryDeadlineDays || ""),
        preferred_payment_method: preferredPaymentMethod
      }
    },
    externalReference
  };
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    sendSafeError(res, 405, "Metodo nao permitido");
    return;
  }

  if (!MP_ACCESS_TOKEN) {
    sendSafeError(res, 500, "Checkout indisponivel no momento");
    return;
  }

  const body = parseJsonBody(req);
  if (!body) {
    sendSafeError(res, 400, "Dados invalidos");
    return;
  }

  const validationError = validatePayload(body);
  if (validationError) {
    sendSafeError(res, 400, validationError);
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
    sendSafeError(res, 500, "Nao foi possivel abrir o checkout agora");
  }
}
