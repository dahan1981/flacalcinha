#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const API_BASE_URL = "https://api.mercadopago.com";
const ACCESS_TOKEN =
  process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN || "";

function parseArgs(argv) {
  const args = {
    from: "",
    to: "",
    status: "",
    limit: 500,
    pageSize: 50
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];

    if (argument === "--from" && next) {
      args.from = next;
      index += 1;
      continue;
    }

    if (argument === "--to" && next) {
      args.to = next;
      index += 1;
      continue;
    }

    if (argument === "--status" && next) {
      args.status = next;
      index += 1;
      continue;
    }

    if (argument === "--limit" && next) {
      args.limit = Math.max(1, Number(next) || args.limit);
      index += 1;
      continue;
    }

    if (argument === "--page-size" && next) {
      args.pageSize = Math.max(1, Math.min(100, Number(next) || args.pageSize));
      index += 1;
    }
  }

  return args;
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
      Authorization: `Bearer ${ACCESS_TOKEN}`,
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
  const item = payment.additional_info?.items?.[0] || {};
  const firstName = sanitize(payer.first_name);
  const lastName = sanitize(payer.last_name);
  const payerName = [firstName, lastName].filter(Boolean).join(" ");

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
    customer_name: sanitize(metadata.customer_name) || payerName,
    customer_email: sanitize(metadata.customer_email) || sanitize(payer.email),
    customer_phone:
      sanitize(metadata.customer_phone) ||
      sanitize(payer.phone?.number) ||
      sanitize(additionalPayer.phone?.number),
    product_name: sanitize(metadata.product_name) || sanitize(item.title),
    quantity: Number(metadata.quantity || item.quantity || 1),
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

function escapeCsv(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(","))
  ];
  return lines.join("\n");
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function buildOutputBasePath() {
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
  return path.join(outputDir, `mercadopago-payments-${stamp}`);
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error("Defina MP_ACCESS_TOKEN ou MERCADO_PAGO_ACCESS_TOKEN antes de rodar o script.");
  }

  const args = parseArgs(process.argv);
  const rows = [];
  let offset = 0;

  while (rows.length < args.limit) {
    const pageSize = Math.min(args.pageSize, args.limit - rows.length);
    const page = await fetchPaymentsPage({
      from: args.from,
      to: args.to,
      status: args.status,
      limit: pageSize,
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

  const outputBasePath = buildOutputBasePath();
  const jsonPath = `${outputBasePath}.json`;
  const csvPath = `${outputBasePath}.csv`;

  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(csvPath, toCsv(rows), "utf8");

  console.log(`Pagamentos exportados: ${rows.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);

  if (rows.length) {
    const withEmail = rows.filter(row => row.customer_email).length;
    console.log(`Com e-mail identificável: ${withEmail}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
