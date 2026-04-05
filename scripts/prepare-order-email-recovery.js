#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_CUTOFF = "2026-04-05T07:58:18-03:00";

function parseArgs(argv) {
  const args = {
    input: "",
    before: DEFAULT_CUTOFF
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];

    if (argument === "--input" && next) {
      args.input = next;
      index += 1;
      continue;
    }

    if (argument === "--before" && next) {
      args.before = next;
      index += 1;
    }
  }

  return args;
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
  return path.join(outputDir, `mercadopago-recovery-batch-${stamp}`);
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
  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(","))
  ].join("\n");
}

function loadInputFile(inputPath) {
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("O arquivo de entrada precisa ser um array JSON.");
  }

  return parsed;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function pickRelevantDate(payment) {
  return normalizeString(payment.date_approved || payment.date_created);
}

function prepareRow(payment) {
  return {
    payment_id: payment.id,
    external_reference: normalizeString(payment.external_reference),
    date_approved: normalizeString(payment.date_approved),
    customer_name: normalizeString(payment.customer_name),
    customer_email: normalizeString(payment.customer_email),
    customer_phone: normalizeString(payment.customer_phone),
    product_name: normalizeString(payment.product_name),
    quantity: Number(payment.quantity || 1),
    payment_method: normalizeString(payment.payment_method || payment.payment_type || "Mercado Pago"),
    subtotal: Number(payment.subtotal || 0),
    shipping_cost: Number(payment.shipping_cost || 0),
    total: Number(payment.total || payment.transaction_amount || 0),
    shipping_mode: normalizeString(payment.shipping_mode),
    shipping_label: normalizeString(payment.shipping_label),
    address_city: normalizeString(payment.address_city),
    address_state: normalizeString(payment.address_state),
    recovery_reason: "Pagamento aprovado antes da correção do webhook de e-mail"
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    throw new Error("Use --input com o caminho do JSON exportado pelo script do Mercado Pago.");
  }

  const sourcePayments = loadInputFile(args.input);
  const cutoffTime = new Date(args.before).getTime();

  if (Number.isNaN(cutoffTime)) {
    throw new Error("Data inválida em --before.");
  }

  const dedupe = new Set();
  const batch = sourcePayments
    .filter(payment => normalizeString(payment.status).toLowerCase() === "approved")
    .filter(payment => normalizeString(payment.customer_email))
    .filter(payment => {
      const relevantDate = new Date(pickRelevantDate(payment)).getTime();
      return !Number.isNaN(relevantDate) && relevantDate < cutoffTime;
    })
    .map(prepareRow)
    .filter(row => {
      const key = `${row.payment_id}:${row.customer_email}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });

  const outputBasePath = buildOutputBasePath();
  const jsonPath = `${outputBasePath}.json`;
  const csvPath = `${outputBasePath}.csv`;

  fs.writeFileSync(jsonPath, JSON.stringify(batch, null, 2), "utf8");
  fs.writeFileSync(csvPath, toCsv(batch), "utf8");

  console.log(`Candidatos para reenvio: ${batch.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Critério: aprovados antes de ${args.before}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
