# GridPilot

> Plataforma de negociação com **grade dinâmica** para contratos perpétuos ETH/USDT · Compatível com Binance / Gate.io / OKX
> Decisões em tempo real, como um trader que acompanha o mercado de perto, em vez de simplesmente colocar as ordens e esquecê-las.

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · **Português** · [Italiano](README.it.md) · [한국어](README.ko.md) · [ไทย](README.th.md) · [Tiếng Việt](README.vi.md)

---

## 📸 Visão geral da interface

| Painel · Visão geral | Taxas e rebates |
|:---:|:---:|
| ![Painel do GridPilot](docs/screenshots/pt/dashboard.png) | ![Taxas e rebates](docs/screenshots/pt/fees.png) |

> Tema da marca em verde-azulado escuro · Fontes Space Grotesk / IBM Plex · 12 idiomas integrados, com a interface acompanhando a troca de idioma.

## 🎯 Por que negociação em grade?

A negociação em grade divide uma faixa de preço em várias "linhas de grade": a cada queda de um nível, compra; a cada subida de um nível, vende — **comprando na baixa e vendendo na alta repetidamente em mercados laterais, transformando a própria volatilidade em lucro**. Ela não tenta prever altas ou baixas, apenas captura a diferença das oscilações de ida e volta dentro da faixa, sendo por isso especialmente adequada a mercados sem tendência clara, que oscilam para cima e para baixo.

Em comparação com "comprar e segurar": comprar e segurar só gera lucro quando o preço sobe no final; a grade acumula continuamente pequenos lucros, um a um, durante a lateralização. O preço a pagar é a necessidade de gerenciar ordens e controlar o risco de forma contínua — e é exatamente essa parte que o GridPilot automatiza para você.

> ⚠️ A negociação em grade não é lucro garantido: em quedas unidirecionais ainda há perdas não realizadas, e a alavancagem amplia o risco. Entenda bem a estratégia antes de investir.

## 🚀 Nossas 5 grandes inovações sobre a grade nativa das corretoras

O robô de grade que vem nas corretoras é, em essência, "colocar um lote de ordens estáticas de uma só vez, deixá-las paradas e esperar o mercado bater nelas". A diferença central do GridPilot é **usar um programa para simular um trader experiente que acompanha o mercado de perto**:

| Dimensão | Grade nativa da corretora | GridPilot |
|------|----------------|-----------|
| **Forma de ordenar** | Ordens estáticas em lote, imóveis após colocadas | Acompanhamento automatizado: a cada atualização de preço reavalia antes de agir, colocando/modificando/cancelando ordens dinamicamente; em qualquer instante pode não haver ordem ativa |
| **Taxas** | Não distingue execução ativa de passiva | Precificação em três faixas: na faixa POC coloca ordem Maker (economiza ~0,03%), na faixa GTC permite execução como Taker para travar o lucro excedente, e na faixa de circuit breaker recusa a ordem |
| **Momento de abrir posição** | Abre a posição assim que entra na faixa | Entrada com trailing: ao entrar na faixa, primeiro persegue o ponto baixo e só abre a posição após confirmar o repique, evitando entrar já no topo e ficar preso |
| **Stop loss** | Liquidação total de uma só vez em um único preço | Redução em camadas com ordens algorítmicas de amortecimento; se o preço romper para baixo brevemente e repicar, a posição residual se beneficia diretamente, poupando as taxas de reconstrução |
| **Adaptação ao mercado** | Faixa única e fixa | Múltiplas faixas que não se sobrepõem; o preço ativa a faixa em que entra e as demais ficam dormentes |

1. **Mentalidade de observar antes de decidir**: a cada cotação recebida, o sistema avalia a relação entre o preço atual e o preço-alvo — se as condições forem desfavoráveis, espera e observa; só quando forem favoráveis se posiciona no melhor preço; e, em saltos bruscos de preço, ainda consegue capturar um spread adicional além do passo da grade.
2. **Maker preferencial / Taker permitido / circuito desfavorável**: por padrão coloca ordens Maker Post-Only para pagar taxa menor; só toma a liquidez ativamente (Taker) quando o lucro adicional supera o custo de tomar e a oportunidade é fugaz; quando o preço atual está mais caro que o preço de compra-alvo, recusa a ordem diretamente, evitando comprar caro e vender barato.
3. **Entrada com trailing**: evita abrir posição no topo e ficar preso.
4. **Stop loss algorítmico em camadas**: preserva a capacidade de recuperação no repique.
5. **Múltiplas faixas de preço**: para onde o preço for, a estratégia o acompanha.

> Os princípios completos da estratégia estão em [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md).

## ✨ Visão geral dos recursos

- **Múltiplas faixas de preço**: configure previamente várias faixas que não se sobrepõem (como 2000–2600, 2600–3200); o preço ativa a faixa em que entra
- **Entrada com trailing**: persegue o ponto baixo e só abre posição após confirmar o repique
- **Precificação dinâmica em três faixas**: Maker na faixa POC, trava do lucro excedente na faixa GTC, recusa de ordem na faixa de circuit breaker
- **Amortecimento de stop loss em camadas**: ordens condicionais algorítmicas em vários níveis abaixo da grade principal, reduzindo a posição em camadas
- **Push em tempo real via WebSocket**: eventos de Ticker / execuções / máquina de estados sincronizados em tempo real com o front-end
- **Suporte a múltiplas corretoras**: interface de adaptador unificada, compatível com Binance, Gate.io e OKX
- **Interface multilíngue**: 12 idiomas integrados

## 💰 Entenda as taxas e economize com código de convite ao se cadastrar (patrocinador rebateto.me)

As taxas são cobradas pelas corretoras, e o **GridPilot não fica com nenhum centavo**. Numa mesma operação, ordem passiva (Maker) ≈0,02% e ordem ativa (Taker) ≈0,05%. Com alavancagem e grade de alta frequência, as taxas vão sendo silenciosamente ampliadas e, acumuladas dia após dia, não são pouca coisa — por padrão, o GridPilot coloca ordens Maker por você, economizando cerca de 0,03% por operação, e só toma a liquidez ativamente quando a oportunidade é fugaz.

E vai além: **ao preencher um código de rebate ao se cadastrar na corretora, você passa a receber de volta cerca de 20% (Gate 40%) das taxas já pagas, de forma contínua e automática** — é como dar mais um desconto em cada operação.

> ⚠️ Cada corretora só pode ser registrada uma vez, e o rebate só pode ser vinculado no momento do cadastro; **contas antigas não conseguem fazer isso depois — esta é a única chance**.

**Patrocinador [rebateto.me](https://rebateto.me)** reúne e mantém os pontos de cadastro com rebate de cada corretora. Ao se cadastrar, use o código de convite:

| Corretora | Código de convite | Percentual de rebate |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> Ao se cadastrar pelo App, lembre-se de preencher manualmente o código de convite — se esquecer, não recebe o retorno. Cada documento de identidade pode abrir apenas uma conta por corretora.

## 📦 Instalação

**Pré-requisitos**: Node.js ≥ 20, pnpm ≥ 9, Docker

### Opção 1: Docker full stack em um comando (recomendado para auto-hospedagem)

```bash
git clone <repo-url> && cd grid-pilot
cp .env.example .env
# 生成加密密钥并填入 .env 的 ENCRYPTION_KEY
openssl rand -base64 32
# 一键起 PostgreSQL + Redis + API + Web（自动执行数据库迁移）
docker compose --profile full up --build -d
```

Após iniciar, acesse http://localhost:3300 .

> Sem `--profile full`, o `docker compose up` inicia apenas a infraestrutura PostgreSQL + Redis, para uso em desenvolvimento local.

### Opção 2: Instalação local (recomendado para desenvolvimento)

```bash
git clone <repo-url> && cd grid-pilot
pnpm install
cp .env.example .env        # 按需调整端口/密钥
pnpm dev                    # 先起 docker 基础设施，再起 API + Web
```

| Serviço | Endereço | Item de configuração |
|------|------|--------|
| Front-end | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| API back-end | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

Iniciar individualmente:

```bash
pnpm dev:infra        # 仅 PostgreSQL + Redis
pnpm dev:api          # 仅后端
pnpm dev:web          # 仅前端
pnpm dev:skip-infra   # API + Web，跳过 docker
```

## 🕹️ Instruções de uso

1. **Conecte a corretora**: insira a API Key/Secret nas configurações. **Conceda apenas a permissão de negociação de contratos; jamais habilite a permissão de saque.**
2. **Configure a grade**: escolha o par de negociação e a faixa de preço, defina o número de níveis da grade principal, o passo, a quantidade por nível, a alavancagem, o amortecimento de stop loss e os parâmetros de entrada com trailing.
3. **Inicie o robô**: entre na entrada com trailing → execução; o front-end exibe em tempo real cotações, ordens, execuções e a máquina de estados.
4. **Monitoramento e encerramento**: ao acionar o take profit, para de aumentar a posição e encerra; ao acionar o amortecimento de stop loss, reduz a posição em camadas.

Parâmetros principais:

| Parâmetro | Descrição |
|------|------|
| `takeProfitPrice` | Preço de take profit (limite superior do range) |
| `mainGridCount` / `mainGridStep` | Número de níveis da grade principal / passo de cada nível (USDT) |
| `mainGridPortionSize` | Quantidade por ordem em cada nível |
| `leverage` | Múltiplo de alavancagem |
| `stopLossGridCount` / `stopLossGridStep` | Número de níveis / passo da zona de amortecimento de stop loss |
| `activationPrice` / `trailingCallbackRate` | Preço de ativação da entrada com trailing / amplitude de callback |
| `excessProfitMultiplier` | Múltiplo de disparo da faixa GTC (limiar de lucro excedente) |

Os parâmetros completos estão em [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md).

## ⚠️ Avisos importantes

- **Isenção de risco**: a negociação de contratos tem alta alavancagem e alto risco, podendo causar a perda total do capital. Este projeto é uma ferramenta de negociação de código aberto, **não constitui qualquer recomendação de investimento** e não se responsabiliza por lucros ou perdas. Valide bem com pouco capital ou na testnet da corretora antes.
- **Permissões da API**: habilite apenas a permissão de negociação de contratos; **não** habilite a permissão de saque.
- **Restrição de runner único**: para o mesmo par de negociação da mesma conta da mesma corretora, só pode rodar um robô por vez.
- **Momento do rebate**: o código de convite só pode ser vinculado no cadastro; contas antigas não conseguem preencher depois.
- **Segurança da chave**: a `ENCRYPTION_KEY` é usada para criptografar as credenciais da corretora; use sempre uma chave forte gerada aleatoriamente e guarde-a com cuidado.
- **Conflito de portas**: se as portas locais 3300/3301 estiverem ocupadas pelo `pnpm dev`, haverá conflito com os contêineres full stack do Docker; pare os processos locais antes de iniciar os contêineres, ou altere a configuração de portas no `.env`.

## 🏗️ Stack tecnológica e arquitetura

| Camada | Tecnologia |
|------|------|
| Front-end | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| Back-end | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| Infraestrutura | PostgreSQL 16 · Redis 7 · Docker Compose |
| Compartilhado | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/          # Next.js 前端（暗色主题，12 语）
apps/api/          # NestJS 后端
packages/shared-types/  # 前后端共享类型
docs/              # STRATEGY_SPEC.md（策略规格）· ARCHITECTURE.md（组件映射）
docker-compose.yml # 默认基础设施；--profile full 全栈
```

**Máquina de estados da estratégia**: `TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`; `RUNNING` pode ramificar para `TAKE_PROFIT`; os ramos operacionais incluem `PAUSED` (que pode ser restaurado com `USER_RESUME`), `CANCELLED` e `HOLD`.

**Comandos de desenvolvimento**:

```bash
pnpm dev          # 一键起所有服务
pnpm build        # 构建
pnpm test         # 测试
pnpm lint         # Lint
```

**Banco de dados** (desenvolvimento local):

```bash
cd apps/api
pnpm prisma migrate dev    # 执行迁移
pnpm prisma studio         # 查看数据
```

## Índice da documentação

| Documento | Descrição |
|------|------|
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | Especificação completa da estratégia (referência autoritativa) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Índice de mapeamento de componentes de código para seções da especificação |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | Explicação sobre taxas e funding |
