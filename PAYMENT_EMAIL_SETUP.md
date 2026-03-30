Pagamento confirmado por e-mail

O projeto agora tem um webhook em `api/payment-webhook.js`.

Objetivo:
- quando o Mercado Pago confirmar um pagamento aprovado, o Vercel envia e-mail para `flacalcinhasrn@gmail.com`
- a cliente tambem recebe um e-mail de confirmacao do pedido

Variaveis de ambiente no Vercel:
- `RESEND_API_KEY`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `NOTIFICATION_EMAIL`

Valor recomendado:
- `NOTIFICATION_EMAIL=flacalcinhasrn@gmail.com`

URL do webhook:
- `/api/payment-webhook`

Seguranca:
- configure a assinatura secreta do Mercado Pago e use o mesmo valor em `MP_WEBHOOK_SECRET`

Rota de criacao do checkout:
- `POST /api/create-payment-preference`

Fluxo:
- o frontend envia cliente, endereco, produto e quantidade para `api/create-payment-preference`
- a function cria a preferencia do Checkout Pro e redireciona para o Mercado Pago
- o Mercado Pago chama `api/payment-webhook`
- o webhook consulta o pagamento real na API do Mercado Pago
- se o status estiver `approved`, envia e-mail para a operacao e para a cliente

Observacao:
- o frete por CEP ainda nao esta integrado nesta versao
