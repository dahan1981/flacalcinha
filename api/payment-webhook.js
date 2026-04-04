const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
const EMAIL_FROM = process.env.EMAIL_FROM || "Flacalcinha <onboarding@resend.dev>";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "Nao informado";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(numeric);
}

function parseSignature(signatureHeader) {
  const entries = String(signatureHeader || "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        accumulator[key] = value;
      }
      return accumulator;
    }, {});

  return {
    ts: entries.ts || "",
    v1: entries.v1 || ""
  };
}

function getQueryParams(req) {
  const base = `https://${getHeader(req, "host") || "flacalcinha.vercel.app"}`;
  const url = new URL(req.url || "/", base);
  return url.searchParams;
}

function getNotificationId(req, payload) {
  const params = getQueryParams(req);
  return (
    params.get("data.id") ||
    params.get("id") ||
    payload?.data?.id ||
    payload?.id ||
    ""
  );
}

async function createWebhookHash(secret, manifest) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyWebhookSignature(req, notificationId) {
  if (!MP_WEBHOOK_SECRET) {
    return true;
  }

  const signatureHeader = getHeader(req, "x-signature");
  const requestId = getHeader(req, "x-request-id");
  if (!signatureHeader || !requestId || !notificationId) {
    return false;
  }

  const { ts, v1 } = parseSignature(signatureHeader);
  if (!ts || !v1) {
    return false;
  }

  const manifest = `id:${notificationId};request-id:${requestId};ts:${ts};`;
  const hash = await createWebhookHash(MP_WEBHOOK_SECRET, manifest);
  return hash === v1;
}

async function getPaymentDetails(paymentId) {
  if (!MP_ACCESS_TOKEN) {
    throw new Error("MP_ACCESS_TOKEN nao configurado");
  }

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    const apiError = result?.message || result?.error || "Falha ao consultar pagamento";
    throw new Error(apiError);
  }

  return result;
}

function normalizePayment(payment) {
  const metadata = payment.metadata || {};
  const item = payment.additional_info?.items?.[0] || {};

  return {
    id: payment.id,
    status: String(payment.status || "").toLowerCase(),
    externalReference: payment.external_reference || "Sem referencia",
    paymentMethod:
      payment.payment_method_id === "pix"
        ? "Pix"
        : payment.payment_type_id === "credit_card"
          ? "Cartao de credito"
          : payment.payment_method_id || payment.payment_type_id || "Mercado Pago",
    customerName: metadata.customer_name || payment.payer?.first_name || "Cliente",
    customerEmail: payment.payer?.email || "",
    customerPhone:
      payment.payer?.phone?.number ||
      payment.additional_info?.payer?.phone?.number ||
      "",
    productName: metadata.product_name || item.title || "Leque Flacalcinha",
    quantity: Number(metadata.quantity || item.quantity || 1),
    subtotal: Number(metadata.subtotal || payment.transaction_details?.total_paid_amount || payment.transaction_amount || 0),
    shippingCost: Number(metadata.shipping_cost || 0),
    shippingLabel: metadata.shipping_label || (Number(metadata.shipping_cost || 0) > 0 ? "Frete Jadlog" : "Retirada com a vendedora"),
    shippingMode: metadata.shipping_mode || "delivery",
    total: Number(payment.transaction_amount || metadata.total || metadata.subtotal || 0),
    address: {
      cep: metadata.address_cep || "Nao informado",
      street: "Coletado no checkout",
      number: "-",
      district: "-",
      city: metadata.address_city || "Nao informado",
      state: metadata.address_state || "Nao informado",
      complement: "",
      notes: ""
    }
  };
}

function buildAdminEmail(order) {
  return {
    subject: `${order.customerName} adquiriu o leque dela`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#fafafa; padding:32px;">
        <div style="max-width:680px; margin:0 auto; background:#151515; border:1px solid #2b2b2b; border-radius:18px; overflow:hidden;">
          <div style="padding:28px 28px 20px; background:linear-gradient(135deg,#8b0000,#cc0000);">
            <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.6px; text-transform:uppercase; opacity:.9;">Pedido aprovado</p>
            <h1 style="margin:0; font-size:28px; line-height:1.2;">${escapeHtml(order.customerName)} adquiriu o leque dela</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 18px; color:#d8d8d8; line-height:1.7;">
              O Mercado Pago confirmou o pagamento e o pedido ja esta validado automaticamente.
            </p>
            <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
              <p style="margin:0 0 8px;"><strong>Pedido:</strong> ${escapeHtml(order.externalReference)}</p>
              <p style="margin:0 0 8px;"><strong>Pagamento:</strong> ${escapeHtml(order.paymentMethod)}</p>
              <p style="margin:0 0 8px;"><strong>ID do pagamento:</strong> ${escapeHtml(order.id)}</p>
              <p style="margin:0 0 8px;"><strong>Produto:</strong> ${escapeHtml(order.productName)}</p>
              <p style="margin:0 0 8px;"><strong>Quantidade:</strong> ${escapeHtml(order.quantity)}</p>
              <p style="margin:0 0 8px;"><strong>Subtotal:</strong> ${formatMoney(order.subtotal)}</p>
              <p style="margin:0 0 8px;"><strong>Frete:</strong> ${escapeHtml(order.shippingMode === "pickup" ? order.shippingLabel : `${order.shippingLabel} (${formatMoney(order.shippingCost)})`)}</p>
              <p style="margin:0;"><strong>Total pago:</strong> ${formatMoney(order.total)}</p>
            </div>
            <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
              <p style="margin:0 0 8px;"><strong>Nome:</strong> ${escapeHtml(order.customerName)}</p>
              <p style="margin:0 0 8px;"><strong>E-mail:</strong> ${escapeHtml(order.customerEmail)}</p>
              <p style="margin:0;"><strong>Numero:</strong> ${escapeHtml(order.customerPhone || "-")}</p>
            </div>
            <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px;">
              <p style="margin:0 0 8px;"><strong>CEP:</strong> ${escapeHtml(order.address.cep)}</p>
              <p style="margin:0 0 8px;"><strong>Rua e numero:</strong> ${escapeHtml(`${order.address.street}, ${order.address.number}`)}</p>
              <p style="margin:0 0 8px;"><strong>Regiao:</strong> ${escapeHtml(`${order.address.district} - ${order.address.city}/${order.address.state}`)}</p>
              <p style="margin:0 0 8px;"><strong>Complemento:</strong> ${escapeHtml(order.address.complement || "-")}</p>
              <p style="margin:0;"><strong>Observacoes:</strong> ${escapeHtml(order.address.notes || "-")}</p>
            </div>
          </div>
        </div>
      </div>
    `
  };
}

function buildCustomerEmail(order) {
  return {
    subject: "Seu pedido Flacalcinha foi confirmado",
    html: `
      <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#fafafa; padding:32px;">
        <div style="max-width:680px; margin:0 auto; background:#151515; border:1px solid #2b2b2b; border-radius:18px; overflow:hidden;">
          <div style="padding:28px 28px 20px; background:linear-gradient(135deg,#8b0000,#cc0000);">
            <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.6px; text-transform:uppercase; opacity:.9;">Pagamento confirmado</p>
            <h1 style="margin:0; font-size:28px; line-height:1.2;">Seu leque ja esta garantido</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 18px; color:#d8d8d8; line-height:1.7;">
              Oi, ${escapeHtml(order.customerName)}. Seu pagamento foi aprovado e o seu pedido da Flacalcinha foi recebido com sucesso.
            </p>
            <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
              <p style="margin:0 0 8px;"><strong>Pedido:</strong> ${escapeHtml(order.externalReference)}</p>
              <p style="margin:0 0 8px;"><strong>Produto:</strong> ${escapeHtml(order.productName)}</p>
              <p style="margin:0 0 8px;"><strong>Quantidade:</strong> ${escapeHtml(order.quantity)}</p>
              <p style="margin:0 0 8px;"><strong>Forma de pagamento:</strong> ${escapeHtml(order.paymentMethod)}</p>
              <p style="margin:0;"><strong>Total pago:</strong> ${formatMoney(order.total)}</p>
            </div>
            <p style="margin:0; color:#d8d8d8; line-height:1.7;">
              ${escapeHtml(order.shippingMode === "pickup" ? "Seu pedido ficou marcado para retirada com a vendedora." : "Seu frete ja foi calculado e o pedido segue para a proxima etapa de atendimento.")}
            </p>
          </div>
        </div>
      </div>
    `
  };
}

async function sendResendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL) {
    throw new Error("Email environment not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao enviar email: ${response.status} ${text}`);
  }
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const payload = parseJsonBody(req) || {};
  const notificationType = String(payload.type || getQueryParams(req).get("type") || "").toLowerCase();
  const notificationId = getNotificationId(req, payload);

  if (notificationType && notificationType !== "payment") {
    res.status(200).json({ ok: true, ignored: true, reason: "Notification type ignored" });
    return;
  }

  if (!notificationId) {
    res.status(200).json({ ok: true, ignored: true, reason: "Missing payment id" });
    return;
  }

  if (!(await verifyWebhookSignature(req, notificationId))) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const payment = await getPaymentDetails(notificationId);
    const order = normalizePayment(payment);

    if (order.status !== "approved") {
      res.status(200).json({ ok: true, ignored: true, reason: `Payment status is ${order.status}` });
      return;
    }

    const adminEmail = buildAdminEmail(order);
    const customerEmail = buildCustomerEmail(order);

    await sendResendEmail({
      to: NOTIFICATION_EMAIL,
      subject: adminEmail.subject,
      html: adminEmail.html,
      replyTo: order.customerEmail || undefined
    });

    if (order.customerEmail) {
      await sendResendEmail({
        to: order.customerEmail,
        subject: customerEmail.subject,
        html: customerEmail.html,
        replyTo: NOTIFICATION_EMAIL
      });
    }

    res.status(200).json({
      ok: true,
      customerNotified: Boolean(order.customerEmail)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
