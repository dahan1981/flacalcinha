const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "lomaduda31@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

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

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isPaidStatus(status) {
  return ["paid", "approved", "completed", "succeeded", "success"].includes(status);
}

function extractOrder(payload) {
  const order = payload?.order || payload?.data || payload?.payment || payload || {};
  const customer = order.customer || payload?.customer || {};
  const shipping = order.shipping || order.address || payload?.shipping || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const primaryItem = items[0] || {};

  return {
    status: normalizeStatus(order.status || payload?.status || payload?.event),
    paymentMethod:
      order.paymentMethod ||
      order.payment_method ||
      payload?.paymentMethod ||
      payload?.payment_method ||
      "Nao informado",
    orderId: order.id || order.orderId || payload?.id || payload?.orderId || "Sem ID",
    customerName:
      customer.name ||
      order.customerName ||
      order.name ||
      payload?.customerName ||
      "Cliente",
    customerEmail: customer.email || order.email || payload?.email || "Nao informado",
    customerPhone: customer.phone || order.phone || payload?.phone || "Nao informado",
    productName:
      primaryItem.name ||
      order.productName ||
      payload?.productName ||
      "Leque Flacalcinha",
    quantity: Number(primaryItem.quantity || order.quantity || payload?.quantity || 1),
    subtotal:
      order.subtotal ||
      payload?.subtotal ||
      order.amount ||
      payload?.amount ||
      null,
    shippingCost: order.shippingCost || order.shipping_cost || payload?.shippingCost || null,
    total: order.total || payload?.total || order.amount || payload?.amount || null,
    notes: order.notes || payload?.notes || "",
    addressLine:
      shipping.street ||
      shipping.address ||
      order.addressLine ||
      payload?.addressLine ||
      "Endereco nao informado",
    addressNumber: shipping.number || order.addressNumber || payload?.addressNumber || "s/n",
    district: shipping.district || payload?.district || "Nao informado",
    city: shipping.city || payload?.city || "Nao informado",
    state: shipping.state || payload?.state || "Nao informado",
    postalCode: shipping.postalCode || shipping.zip || payload?.postalCode || payload?.zip || "Nao informado",
    raw: payload
  };
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") {
    return "Nao informado";
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(numeric);
}

function buildEmail(order) {
  const subject = `${order.customerName} adquiriu o leque dela`;
  const html = `
    <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#fafafa; padding:32px;">
      <div style="max-width:640px; margin:0 auto; background:#151515; border:1px solid #2b2b2b; border-radius:18px; overflow:hidden;">
        <div style="padding:28px 28px 20px; background:linear-gradient(135deg,#8b0000,#cc0000);">
          <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.6px; text-transform:uppercase; opacity:.9;">Novo pedido confirmado</p>
          <h1 style="margin:0; font-size:28px; line-height:1.2;">${order.customerName} adquiriu o leque dela</h1>
        </div>

        <div style="padding:28px;">
          <p style="margin:0 0 18px; color:#d8d8d8; line-height:1.7;">
            O pagamento foi confirmado e a torcida ganhou mais uma dona de leque. Seguem os detalhes do pedido para voce acompanhar.
          </p>

          <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:18px;">
            <p style="margin:0 0 8px;"><strong>Pedido:</strong> ${order.orderId}</p>
            <p style="margin:0 0 8px;"><strong>Produto:</strong> ${order.productName}</p>
            <p style="margin:0 0 8px;"><strong>Quantidade:</strong> ${order.quantity}</p>
            <p style="margin:0 0 8px;"><strong>Pagamento:</strong> ${order.paymentMethod}</p>
            <p style="margin:0 0 8px;"><strong>Subtotal:</strong> ${formatMoney(order.subtotal)}</p>
            <p style="margin:0 0 8px;"><strong>Frete:</strong> ${formatMoney(order.shippingCost)}</p>
            <p style="margin:0;"><strong>Total:</strong> ${formatMoney(order.total)}</p>
          </div>

          <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:18px;">
            <p style="margin:0 0 8px;"><strong>Cliente:</strong> ${order.customerName}</p>
            <p style="margin:0 0 8px;"><strong>E-mail:</strong> ${order.customerEmail}</p>
            <p style="margin:0 0 8px;"><strong>WhatsApp:</strong> ${order.customerPhone}</p>
            <p style="margin:0;"><strong>Observacoes:</strong> ${order.notes || "Nenhuma"}</p>
          </div>

          <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px;">
            <p style="margin:0 0 8px;"><strong>Entrega:</strong></p>
            <p style="margin:0; color:#d8d8d8; line-height:1.7;">
              ${order.addressLine}, ${order.addressNumber}<br />
              ${order.district} - ${order.city}/${order.state}<br />
              CEP: ${order.postalCode}
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  return { subject, html };
}

async function sendEmail(order) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY nao configurada");
  }

  const email = buildEmail(order);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Flacalcinha <onboarding@resend.dev>",
      to: [NOTIFICATION_EMAIL],
      subject: email.subject,
      html: email.html
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao enviar email: ${response.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (PAYMENT_WEBHOOK_SECRET) {
    const providedSecret =
      getHeader(req, "x-webhook-secret") ||
      getHeader(req, "authorization")?.replace(/^Bearer\s+/i, "");

    if (providedSecret !== PAYMENT_WEBHOOK_SECRET) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
  }

  const payload = parseJsonBody(req);
  if (!payload) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }

  const order = extractOrder(payload);
  if (!isPaidStatus(order.status)) {
    res.status(200).json({ ok: true, ignored: true, reason: "Payment not marked as paid" });
    return;
  }

  try {
    await sendEmail(order);
    res.status(200).json({ ok: true, deliveredTo: NOTIFICATION_EMAIL });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
