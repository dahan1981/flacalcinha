#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Flacalcinha <contato@flacalcinha.store>";
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "";
const EMAIL_CC = process.env.EMAIL_CC || "";

function parseArgs(argv) {
  const args = {
    input: "",
    limit: Number.POSITIVE_INFINITY,
    dryRun: true
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];

    if (argument === "--input" && next) {
      args.input = next;
      index += 1;
      continue;
    }

    if (argument === "--limit" && next) {
      args.limit = Math.max(1, Number(next) || 1);
      index += 1;
      continue;
    }

    if (argument === "--send") {
      args.dryRun = false;
    }
  }

  return args;
}

function loadBatch(inputPath) {
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("O arquivo de entrada precisa ser um array JSON.");
  }

  return parsed;
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function buildReportPath() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  const outputDir = path.join(process.cwd(), "exports");
  ensureDir(outputDir);
  return path.join(outputDir, `mercadopago-recovery-report-${stamp}.json`);
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
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
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
              Oi, ${escapeHtml(order.customer_name)}. Seu pagamento foi aprovado e o seu pedido da Flacalcinha foi recebido com sucesso.
            </p>
            <div style="background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px; margin-bottom:16px;">
              <p style="margin:0 0 8px;"><strong>Pedido:</strong> ${escapeHtml(order.external_reference)}</p>
              <p style="margin:0 0 8px;"><strong>Produto:</strong> ${escapeHtml(order.product_name)}</p>
              <p style="margin:0 0 8px;"><strong>Quantidade:</strong> ${escapeHtml(order.quantity)}</p>
              <p style="margin:0 0 8px;"><strong>Forma de pagamento:</strong> ${escapeHtml(order.payment_method)}</p>
              <p style="margin:0;"><strong>Total pago:</strong> ${formatMoney(order.total)}</p>
            </div>
            <p style="margin:0; color:#d8d8d8; line-height:1.7;">
              ${escapeHtml(order.shipping_mode === "pickup" ? "Seu pedido ficou marcado para retirada com a vendedora." : "Seu frete ja foi calculado e o pedido segue para a proxima etapa de atendimento.")}
            </p>
            <div style="margin-top:20px; background:#101010; border:1px solid #2b2b2b; border-radius:14px; padding:18px;">
              <p style="margin:0 0 14px; color:#d8d8d8; line-height:1.7;">
                Para acompanhar avisos, atualizacoes e informacoes sobre os leques comprados, entre no grupo oficial:
              </p>
              <a href="https://chat.whatsapp.com/Ftg3NmZv1bkDjXnpOa8lSY?mode=gi_t" style="display:inline-block; background:#cc0000; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 18px; border-radius:10px;">
                Entrar no grupo do WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    `
  };
}

async function sendEmail(order) {
  const message = buildCustomerEmail(order);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [order.customer_email],
      cc: EMAIL_CC ? [EMAIL_CC] : undefined,
      subject: message.subject,
      html: message.html,
      reply_to: NOTIFICATION_EMAIL || undefined
    })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = result?.message || result?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }

  return result?.id || "";
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    throw new Error("Use --input com o caminho do batch JSON.");
  }

  const batch = loadBatch(args.input).slice(0, args.limit);
  const report = [];

  if (!args.dryRun && !RESEND_API_KEY) {
    throw new Error("Defina RESEND_API_KEY antes de enviar.");
  }

  for (const order of batch) {
    if (args.dryRun) {
      report.push({
        payment_id: order.payment_id,
        customer_email: order.customer_email,
        dry_run: true
      });
      continue;
    }

    try {
      const resendId = await sendEmail(order);
      report.push({
        payment_id: order.payment_id,
        customer_email: order.customer_email,
        ok: true,
        resend_id: resendId
      });
    } catch (error) {
      report.push({
        payment_id: order.payment_id,
        customer_email: order.customer_email,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const reportPath = buildReportPath();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Processados: ${report.length}`);
  console.log(`Relatorio: ${reportPath}`);
  if (args.dryRun) {
    console.log("Modo dry-run: nenhum e-mail foi enviado.");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
