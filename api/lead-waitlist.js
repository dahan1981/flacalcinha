const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Flacalcinha <onboarding@resend.dev>";

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

async function readRawBody(req) {
  if (!req || typeof req.on !== "function") {
    return "";
  }

  return await new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendEmail(payload) {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL) {
    throw new Error("Email environment not configured");
  }

  const name = escapeHtml(payload.name);
  const email = escapeHtml(payload.email);
  const phone = escapeHtml(payload.phone);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [NOTIFICATION_EMAIL],
      subject: `${payload.name} entrou na fila de espera`,
      html: `
        <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#fafafa; padding:32px;">
          <div style="max-width:640px; margin:0 auto; background:#151515; border:1px solid #2b2b2b; border-radius:18px; overflow:hidden;">
            <div style="padding:28px 28px 20px; background:linear-gradient(135deg,#8b0000,#cc0000);">
              <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.6px; text-transform:uppercase; opacity:.9;">Novo lead na fila</p>
              <h1 style="margin:0; font-size:28px; line-height:1.2;">${name} chegou na fila de espera</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 18px; color:#d8d8d8; line-height:1.7;">
                Mais uma pessoa interessada no lancamento da Flacalcinha entrou na fila. Seguem os dados para voce acompanhar e responder quando quiser.
              </p>
              <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px;">
                <p style="margin:0 0 8px;"><strong>Nome:</strong> ${name}</p>
                <p style="margin:0 0 8px;"><strong>E-mail:</strong> ${email}</p>
                <p style="margin:0;"><strong>Numero:</strong> ${phone}</p>
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
  setNoStore(res);

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let payload = parseJsonBody(req);
  if (!payload) {
    const rawBody = await readRawBody(req);
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = null;
      }
    }
  }

  if (!payload) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }

  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const phone = String(payload.phone || "").trim();
  const privacyConsent = Boolean(payload.privacyConsent);

  if (!name || !email || !phone || !privacyConsent) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  try {
    await sendEmail({ name, email, phone });
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
