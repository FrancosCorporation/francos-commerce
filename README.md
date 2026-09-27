# FrancosCommerce — Full-stack E-commerce

![Status](https://img.shields.io/badge/M1-funcionando%20(6%2F6%20testes)-brightgreen)
![CI](https://img.shields.io/badge/CI-test%20%2B%20license%20check-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![Stripe](https://img.shields.io/badge/Stripe-test%20mode-635BFF?logo=stripe)
![License](https://img.shields.io/badge/license-MIT-green)

A complete e-commerce: storefront + cart + **Stripe test-mode checkout** + orders,
inventory and an **admin panel with roles** — full transactional domain, from
browsing to fulfillment. Single stack (Next.js + Node), zero paid services in the demo.

> 🇧🇷 E-commerce completo: vitrine + carrinho + **checkout Stripe (modo teste)** +
> pedidos, estoque e **painel administrativo com papéis** — o domínio transacional
> inteiro, da navegação ao pós-venda.

## Why this project matters

E-commerce is the densest business domain a junior/mid dev can show: cart state,
checkout idempotency, stock race conditions, order states. Built on a Next.js
storefront foundation with a Node API — one stack, one deploy.

## Features (roadmap)

- [ ] **M1** — Storefront, product catalog, cart, Stripe test checkout, persisted orders
- [ ] **M2** — Admin panel: products, inventory, orders, customer search, roles
- [ ] **M3** — E2E purchase-flow tests, catalog seed, demo deploy

## Architecture

```mermaid
graph LR
  A[Next.js storefront] --> B[Sales API]
  B --> C[(Postgres/Mongo)]
  B --> D[Stripe test-mode]
  E[Admin panel + roles] --> B
```

## Quick start (planned)

```bash
docker compose up   # storefront + api + db
```

## Built with

- [vercel/commerce](https://github.com/vercel/commerce) (MIT, 14k⭐) — storefront
  patterns: product pages, cart UX, SEO
- Foundations: Next.js storefront patterns (from my public e-commerce experiments)
- Node API single-stack decision documented in the repo ADR

## License

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation))

---

### 🇧🇷 Sobre (PT-BR)

E-commerce full-stack unificando meus projetos funcionais (loja Next.js + API de vendas
.NET) com os padrões de UX do vercel/commerce. Checkout Stripe em modo teste, estoque,
pedidos, painel admin com papéis e testes e2e do fluxo de compra. Roadmap de 3 milestones
no PROJETOS_RH.md do workspace.
