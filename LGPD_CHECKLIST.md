Checklist Operacional LGPD

Objetivo:
- manter o site Flacalcinha com tratamento minimo de dados pessoais, finalidade clara e controles operacionais basicos

1. Governanca minima
- definir quem responde por pedidos de titulares
- manter um canal unico para solicitacoes de acesso, correcao e exclusao
- revisar a politica de privacidade sempre que checkout, frete ou captacao de leads mudar

2. Bases e finalidade
- usar dados de compra apenas para pagamento, confirmacao, atendimento e entrega
- usar dados da fila de espera apenas para avisos de lancamento e disponibilidade
- nao reutilizar contatos para campanhas gerais sem base legal adequada

3. Minimizacao de dados
- coletar apenas nome, e-mail, telefone e endereco quando estritamente necessario
- evitar observacoes livres desnecessarias em fluxos futuros
- nao armazenar dados financeiros no site

4. Credenciais e segredos
- manter tokens e chaves somente na Vercel
- nunca deixar credenciais em HTML, JS publico, README ou commits
- rotacionar credenciais compartilhadas anteriormente
- configurar `MP_WEBHOOK_SECRET` no Mercado Pago e na Vercel

5. Terceiros operadores
- confirmar quais servicos tratam dados:
- Mercado Pago
- Resend
- Melhor Envio, quando entrar
- manter registro interno simples desses operadores e da finalidade de uso

6. Retencao e exclusao
- definir prazo interno para apagar leads inativos
- definir prazo para revisar pedidos antigos e dados de suporte
- apagar dados da fila de espera quando a pessoa pedir exclusao

7. Atendimento ao titular
- ter resposta padrao para:
- pedido de acesso
- correcao cadastral
- exclusao da fila de espera
- revogacao de consentimento de comunicacoes

8. Seguranca operacional
- manter `Cache-Control: no-store` nas APIs sensiveis
- revisar logs para evitar exposicao de e-mail, telefone e endereco
- testar periodicamente webhook, e-mails transacionais e consentimentos
- limitar novos campos no checkout ao estritamente necessario

9. Conteudo publico
- manter a politica de privacidade publicada na pagina
- garantir linguagem simples e coerente com o que o site realmente faz
- atualizar o texto quando o frete por CEP entrar e quando houver mudanca de operador

10. Proximos passos recomendados
- publicar um canal de contato para direitos LGPD
- configurar `MP_WEBHOOK_SECRET`
- rotacionar `VERCEL_TOKEN`, `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` e outras credenciais expostas na conversa
- revisar o fluxo quando o Melhor Envio entrar
