const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "flacalcinhasrn@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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

function currency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

async function sendEmail({ customer, address, order }) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY nao configurada");
  }

  const customerName = escapeHtml(customer.name);
  const customerEmail = escapeHtml(customer.email);
  const customerPhone = escapeHtml(customer.phone);
  const streetLine = escapeHtml([address.street, address.number].filter(Boolean).join(", "));
  const regionLine = escapeHtml([address.district, address.city, address.state].filter(Boolean).join(" - "));
  const complement = escapeHtml(address.complement);
  const notes = escapeHtml(address.notes);
  const shippingLabel = escapeHtml(order.shippingLabel);
  const totalLabel = escapeHtml(order.totalLabel);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Flacalcinha <onboarding@resend.dev>",
      to: [NOTIFICATION_EMAIL],
      subject: `${customer.name} avisou que pagou o pedido dela`,
      reply_to: customer.email,
      html: `
        <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#fafafa; padding:32px;">
          <div style="max-width:680px; margin:0 auto; background:#151515; border:1px solid #2b2b2b; border-radius:18px; overflow:hidden;">
            <div style="padding:28px 28px 20px; background:linear-gradient(135deg,#8b0000,#cc0000);">
              <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.6px; text-transform:uppercase; opacity:.9;">Aviso manual de pagamento</p>
              <h1 style="margin:0; font-size:28px; line-height:1.2;">${customerName} adquiriu o leque dela</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 18px; color:#d8d8d8; line-height:1.7;">
                A cliente informou no site que ja concluiu o pagamento. Seguem os dados do pedido para conferencia manual.
              </p>
              <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
                <p style="margin:0 0 8px;"><strong>Produto:</strong> ${escapeHtml(order.productName)}</p>
                <p style="margin:0 0 8px;"><strong>Quantidade:</strong> ${escapeHtml(order.quantity)}</p>
                <p style="margin:0 0 8px;"><strong>Forma de pagamento:</strong> ${escapeHtml(order.paymentMethod)}</p>
                <p style="margin:0 0 8px;"><strong>Subtotal:</strong> ${currency(order.subtotal)}</p>
                <p style="margin:0 0 8px;"><strong>Frete:</strong> ${shippingLabel}</p>
                <p style="margin:0;"><strong>Total:</strong> ${totalLabel}</p>
              </div>
              <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
                <p style="margin:0 0 8px;"><strong>Nome:</strong> ${customerName}</p>
                <p style="margin:0 0 8px;"><strong>E-mail:</strong> ${customerEmail}</p>
                <p style="margin:0;"><strong>Numero:</strong> ${customerPhone}</p>
              </div>
              <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px;">
                <p style="margin:0 0 8px;"><strong>CEP:</strong> ${escapeHtml(address.cep)}</p>
                <p style="margin:0 0 8px;"><strong>Rua e numero:</strong> ${streetLine}</p>
                <p style="margin:0 0 8px;"><strong>Regiao:</strong> ${regionLine}</p>
                <p style="margin:0 0 8px;"><strong>Complemento:</strong> ${complement || "-"}</p>
                <p style="margin:0;"><strong>Observacoes:</strong> ${notes || "-"}</p>
              </div>
            </div>
          </div>
        </div>
      `
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

  const payload = parseJsonBody(req);
  if (!payload) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }

  const customer = payload.customer || {};
  const address = payload.address || {};
  const order = payload.order || {};

  if (!customer.name || !customer.email || !customer.phone) {
    res.status(400).json({ ok: false, error: "Missing customer fields" });
    return;
  }

  if (!address.cep || !address.street || !address.number || !address.city || !address.state) {
    res.status(400).json({ ok: false, error: "Missing address fields" });
    return;
  }

  try {
    await sendEmail({ customer, address, order });
    res.status(200).json({ ok: true, deliveredTo: NOTIFICATION_EMAIL });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
