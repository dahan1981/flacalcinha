Pagamento confirmado por e-mail

O projeto agora tem um webhook em `api/payment-webhook.js`.

Objetivo:
- quando o pagamento chegar com status pago/aprovado/completed, o Vercel envia e-mail para `lomaduda31@gmail.com`

Variaveis de ambiente no Vercel:
- `RESEND_API_KEY`
- `PAYMENT_WEBHOOK_SECRET`
- `NOTIFICATION_EMAIL`

Valor recomendado:
- `NOTIFICATION_EMAIL=lomaduda31@gmail.com`

URL do webhook:
- `/api/payment-webhook`

Seguranca:
- envie o header `x-webhook-secret` com o mesmo valor de `PAYMENT_WEBHOOK_SECRET`

Payload minimo aceito:

```json
{
  "status": "paid",
  "orderId": "pedido-123",
  "paymentMethod": "pix",
  "customerName": "Maria",
  "email": "maria@email.com",
  "phone": "(21) 99999-9999",
  "productName": "Leque Flacalcinha",
  "quantity": 2,
  "subtotal": 90,
  "shippingCost": 18,
  "total": 108,
  "addressLine": "Rua Exemplo",
  "addressNumber": "123",
  "district": "Centro",
  "city": "Rio de Janeiro",
  "state": "RJ",
  "postalCode": "20000-000",
  "notes": "Entregar em horario comercial"
}
```

Observacao:
- quando voce me disser qual provedor vai cobrar o Pix e o cartao, eu ajusto o webhook para o formato exato dele
