# GridPilot

> Plateforme de trading par **grille dynamique** sur contrats perpétuels ETH/USDT · Compatible Binance / Gate.io / OKX

**Le robot de grille intégré aux exchanges appartient à une autre époque.**

Il pose un paquet d'ordres sur le carnet et ne s'en occupe plus jamais — il ouvre ses positions sans regarder le prix, liquide tout d'un seul coup au stop-loss, et quand le marché fait un bond, il n'encaisse que les prix figés de ses lignes de grille. GridPilot, c'est un trader qui surveille le marché 24 h/24, 7 j/7 : **à chaque tick, il rejuge s'il faut agir, et à quel prix.**

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · **Français** · [Português](README.pt.md) · [Italiano](README.it.md) · [한국어](README.ko.md) · [ไทย](README.th.md) · [Tiếng Việt](README.vi.md)

---

## 📸 Aperçu de l'interface

| Tableau de bord · Vue d'ensemble | Frais et rétrocessions |
|:---:|:---:|
| ![Tableau de bord GridPilot](docs/screenshots/fr/dashboard.png) | ![Frais et rétrocessions](docs/screenshots/fr/fees.png) |

> Thème de marque vert sarcelle foncé · Polices Space Grotesk / IBM Plex · 12 langues intégrées, l'interface s'adapte au changement de langue.

## 🎯 Pourquoi le trading par grille ?

Le trading par grille découpe une fourchette de prix en plusieurs « lignes de grille » : à chaque baisse d'un cran, on achète ; à chaque hausse d'un cran, on vend — **acheter bas et vendre haut de manière répétée dans un marché de fluctuation, en transformant la volatilité elle-même en gains**. Il ne prédit ni la hausse ni la baisse, il ne fait que profiter de l'écart des oscillations à l'intérieur de la fourchette ; il convient donc particulièrement aux marchés sans tendance claire, qui oscillent de haut en bas.

Comparé au « buy and hold » : la stratégie d'achat-conservation ne génère un profit qu'en cas de hausse finale ; la grille, elle, accumule en continu de petits profits dans un marché latéral. La contrepartie, c'est qu'elle nécessite une gestion continue des ordres et un contrôle du risque — et c'est précisément la partie que GridPilot automatise pour vous.

> ⚠️ Le trading par grille n'est pas un gain garanti : en cas de baisse unilatérale, il subit toujours des pertes latentes, et l'effet de levier amplifie le risque. Comprenez d'abord la stratégie avant d'investir.

## 🤔 Avant d'utiliser une grille, posez-vous d'abord ces cinq questions

**Le prix chute encore — pourquoi votre grille s'empresse-t-elle de remplir la position au sommet ?**
La grille native ouvre une position dès que le prix entre dans la fourchette. GridPilot pratique l'**ouverture par suivi** : il accompagne d'abord le point bas et n'entre qu'une fois le rebond de 0,2 % confirmé — ni achat du creux à l'aveugle, ni position coincée en haut. (Le suivi n'a lieu que lorsque le prix entre dans la fenêtre d'activation en allant vers la perte ; s'il remonte dans la fourchette depuis plus profond, en direction du take-profit, GridPilot saute le suivi et démarre directement.)

**Le marché bouge à chaque seconde — pourquoi vos ordres restent-ils figés une fois posés ?**
GridPilot redécide à chaque mise à jour du marché : il annule ce qui doit l'être, modifie ce qui doit l'être, et à tout instant le carnet peut ne contenir aucun ordre. Quand le prix est favorable, il colle au carnet pour verrouiller le meilleur prix ; quand il est défavorable, il préfère déclencher le coupe-circuit et refuser l'ordre ; s'il peut passer en Maker (0,02 %), il ne paiera jamais le Taker (0,05 %) pour rien. Cette poursuite n'a aucun risque à la baisse : si le prix continue de baisser au-delà du prix de grille, GridPilot achète encore moins cher en le suivant ; s'il rebondit sans franchir la ligne du dessus, l'ordre reste exécutable au prix d'origine — selon un modèle standard de ruine du joueur (gambler's ruin), la probabilité de vraiment rater l'exécution est négligeable — le surprofit est gratuit, et le rater ne coûte rien.

**Le prix bondit de 5–10 USDT d'un coup — à part regarder, que peut faire votre grille ?**
Les ordres statiques n'encaissent que les prix figés des lignes de grille. Quand le prix s'écarte du prix théorique de la grille au-delà d'un seuil (0,1 % par défaut, soit ≈ 2× les frais taker, ajustable), GridPilot exécute activement en taker et empoche l'écart de saut au-delà du pas de grille — et les tests le montrent : plus le carnet d'un exchange est « rugueux », plus le surprofit est élevé.

**Une simple cassure éclair — pourquoi liquider toute la position d'un seul coup au marché ?**
Tout clôturer en un clic, c'est payer les frais Taker et renoncer au rebond. GridPilot **réduit la position palier par palier en ordres limites** dans la zone tampon du stop-loss ; si le prix rebondit, la position résiduelle continue directement de gagner. Ce n'est qu'en franchissant la ligne de liquidation qu'un dernier ordre conditionnel de secours prend le relais en une fois.

**Le prix a depuis longtemps quitté la fourchette — pourquoi votre grille tourne-t-elle encore à vide ?**
GridPilot préconfigure plusieurs fourchettes non chevauchantes : celle dans laquelle entre le prix s'active ; après un stop-loss, il entre en « période de refroidissement » et ne reprend le suivi d'ouverture que lorsqu'un signal de stabilisation réapparaît.

## 📊 Comparaison frontale avec la grille native des exchanges

| Dimension | Grille native de l'exchange | GridPilot |
|------|----------------|-----------|
| **Mode de décision** | Ordres statiques posés par lots, qui ne bougent plus une fois placés | Surveillance automatisée : à chaque mise à jour du marché, nouvelle évaluation avant de passer/modifier/annuler dynamiquement un ordre ; à tout instant, il peut n'y avoir aucun ordre en attente |
| **Qualité d'exécution** | Les ordres statiques n'encaissent que le prix des lignes de grille ; le surprofit des sauts de prix passe à côté | Se cale sur le carnet pour verrouiller le meilleur prix, sans jamais exécuter moins bien que le prix théorique ; quand le prix s'écarte du prix théorique au-delà du seuil (≈ 2× les frais par défaut), exécute activement en taker pour verrouiller le surprofit ; coupe-circuit et refus de l'ordre quand le prix est défavorable |
| **Moment d'ouverture** | Ouverture immédiate à l'entrée dans la fourchette | Ouverture par suivi : lorsque le prix entre en allant vers la perte, il accompagne le point bas et n'ouvre qu'après confirmation d'un rebond (0,2 % par défaut) |
| **Stop-loss** | Liquidation totale au marché en une seule fois à un seul prix | Réduction palier par palier en ordres limites dans la zone tampon ; en cas de rebond, la position résiduelle en profite directement ; un ordre conditionnel de secours reste en veille sur la ligne de liquidation |
| **Adaptation au marché** | Fourchette unique fixe | Plusieurs fourchettes non chevauchantes : celle dans laquelle entre le prix s'active, les autres restent en veille |

> Voir [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md) pour la comparaison point par point avec les grilles des exchanges ; voir [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) pour le principe complet de la stratégie.

## ✨ Aperçu des fonctionnalités

- **Auto-réparation sans état** : position cible = f(prix actuel) ; après un crash, une coupure réseau ou une modification manuelle de la position, le redémarrage corrige automatiquement l'écart
- **Diffusion WebSocket en temps réel** : Ticker / exécutions / événements de la machine à états synchronisés en temps réel avec le frontend
- **Support multi-exchanges** : interface d'adaptateur unifiée, compatible Binance, Gate.io, OKX
- **Suggestions de configuration de la fourchette par IA** : recommandations hors ligne de fourchettes et de paramètres, sans intervenir dans les décisions de trading en temps réel
- **Interface multilingue** : 12 langues intégrées

## 💰 Comprendre les frais et économiser à l'inscription avec un code de parrainage (sponsor rebateto.me)

Les frais sont prélevés par l'exchange, **GridPilot n'en prend pas un centime**. Pour une même transaction, l'ordre passif (Maker) ≈0,02 %, l'ordre actif (Taker) ≈0,05 %. Les ordres de grille du quotidien passent en Maker (ordres passifs) des deux côtés : sur les exécutions courantes de la grille, il n'y a aucune différence de frais avec la grille native de l'exchange. L'avantage de GridPilot sur les frais se joue à trois moments clés — ① à l'entrée : il attend la confirmation du rebond pour entrer en ordre passif, au lieu d'ouvrir immédiatement au marché dès l'entrée dans la fourchette ; ② au stop-loss : il réduit palier par palier en ordres limites, au lieu de tout liquider au marché en un clic ; ③ à l'exécution en taker : il ne s'autorise le Taker que lorsque l'écart excédentaire couvre réellement les frais.

Pour aller plus loin : **en renseignant un code de rétrocession lors de l'inscription à l'exchange, vous pouvez vous faire restituer durablement environ 20 % des frais déjà payés (Gate 40 %), crédités automatiquement** — c'est comme une remise supplémentaire sur chaque transaction.

> ⚠️ On ne peut s'inscrire qu'une seule fois par exchange, et la rétrocession ne peut être liée qu'au moment de l'inscription. **Les anciens comptes ne peuvent pas le rattraper — c'est l'unique occasion.**

**Sponsor [rebateto.me](https://rebateto.me)** recense et maintient les points d'inscription avec rétrocession pour chaque exchange. Lors de l'inscription, utilisez les codes de parrainage suivants :

| Exchange | Code de parrainage | Taux de rétrocession |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> Lors de l'inscription via l'application, pensez à saisir manuellement le code de parrainage — l'oublier vous prive de la restitution. Un seul compte par exchange et par pièce d'identité.

## 📦 Installation

**Prérequis** : Node.js ≥ 20, pnpm ≥ 9, Docker

### Méthode 1 : Docker tout-en-un (recommandé pour l'auto-hébergement)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
cp .env.example .env
# Génère la clé de chiffrement et renseigne-la dans ENCRYPTION_KEY du fichier .env
openssl rand -base64 32
# Démarre PostgreSQL + Redis + API + Web en une commande (migrations exécutées automatiquement)
docker compose --profile full up --build -d
```

Après le démarrage, accédez à http://localhost:3300 .

> Sans `--profile full`, `docker compose up` ne démarre que l'infrastructure PostgreSQL + Redis, destinée au développement local.

### Méthode 2 : installation locale (recommandée pour le développement)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
pnpm install
cp .env.example .env        # ajustez les ports si besoin ; définissez ENCRYPTION_KEY avec la sortie de openssl rand -base64 32
pnpm --filter @gridpilot/api exec prisma generate       # génère le client Prisma (le postinstall est désactivé — cette étape est obligatoire)
pnpm dev:infra              # démarre PostgreSQL + Redis
pnpm exec dotenv -e .env -- pnpm --filter @gridpilot/api exec prisma migrate deploy # première installation uniquement : applique les migrations de la base de données
pnpm dev:skip-infra         # démarre l'API + le Web
```

> Les étapes `prisma generate` / `migrate deploy` ne sont nécessaires qu'une seule fois, lors de la première installation ; ensuite, un simple `pnpm dev` suffit pour tout démarrer.

| Service | Adresse | Option de configuration |
|------|------|--------|
| Frontend | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| API backend | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

Démarrage séparé :

```bash
pnpm dev:infra        # PostgreSQL + Redis uniquement
pnpm dev:api          # backend uniquement
pnpm dev:web          # frontend uniquement
pnpm dev:skip-infra   # API + Web, sans docker
```

## 🕹️ Mode d'emploi

1. **Connecter l'exchange** : renseignez l'API Key/Secret dans les paramètres. **N'accordez que la permission de trading de contrats, n'activez jamais la permission de retrait.**
2. **Configurer la grille** : choisissez la paire de trading et la direction (long / short), définissez le prix d'ancrage du take-profit, le nombre de cellules de la grille principale / le pas, la quantité par cellule, le levier, le tampon de stop-loss et les paramètres d'ouverture par suivi (les bornes de la boîte sont déduites automatiquement du prix d'ancrage du take-profit et du nombre de cellules / pas).
3. **Lancer le robot** : passez en ouverture par suivi → exécution ; le frontend affiche en temps réel le marché, les ordres en attente, les exécutions et la machine à états.
4. **Surveiller et clôturer** : quand le prix atteint le côté take-profit, la grille clôt naturellement en se liquidant palier par palier, puis sort en take-profit une fois la position ramenée à zéro ; en cas d'entrée dans la zone tampon du stop-loss, la position est réduite dynamiquement palier par palier.

Paramètres clés :

| Paramètre | Description |
|------|------|
| `takeProfitPrice` | Prix de take-profit (limite du côté take-profit de la boîte) |
| `direction` | Direction : LONG (long) / SHORT (short) |
| `mainGridCount` / `mainGridStep` | Nombre de cellules de la grille principale / pas par cellule (USDT) |
| `mainGridPortionSize` | Quantité d'ordre par cellule |
| `leverage` | Multiplicateur de levier |
| `stopLossGridCount` / `stopLossGridStep` | Nombre de cellules / pas de la zone tampon de stop-loss |
| `isolationStep` | Largeur de la bande d'isolation (par défaut = pas de la zone de stop-loss) |
| `activationPrice` / `trailingCallbackRate` | Prix d'activation de la fourchette (par défaut, le point médian de la grille principale) / taux de rappel de l'ouverture par suivi |
| `excessProfitMultiplier` | Multiplicateur de déclenchement de la zone GTC (seuil de surprofit) |

Voir tous les paramètres dans [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md).

## ⚠️ Points d'attention

- **Avertissement sur les risques** : le trading de contrats comporte un fort effet de levier et un risque élevé, pouvant entraîner la perte de la totalité du capital. Ce projet est un outil de trading open source, **il ne constitue aucun conseil en investissement** et n'assume aucune responsabilité quant aux gains ou pertes. Validez d'abord pleinement avec un petit capital ou le testnet de l'exchange.
- **Permissions API** : n'activez que la permission de trading de contrats, **n'activez pas** la permission de retrait.
- **Contrainte du runner unique** : pour une même paire de trading sur un même compte d'exchange, un seul robot peut s'exécuter à la fois.
- **Moment de la rétrocession** : le code de parrainage ne peut être lié qu'au moment de l'inscription, les anciens comptes ne peuvent pas le rattraper.
- **Sécurité des clés** : `ENCRYPTION_KEY` sert à chiffrer les identifiants de l'exchange ; veillez impérativement à utiliser une clé forte générée aléatoirement et à la conserver soigneusement.
- **Conflit de ports** : si les ports locaux 3300/3301 sont occupés par `pnpm dev`, ils entreront en conflit avec les conteneurs Docker tout-en-un ; arrêtez d'abord les processus locaux avant de démarrer les conteneurs, ou modifiez la configuration des ports dans `.env`.

## 🏗️ Pile technique et architecture

| Couche | Technologie |
|------|------|
| Frontend | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| Backend | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| Infrastructure | PostgreSQL 16 · Redis 7 · Docker Compose |
| Partagé | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/          # Frontend Next.js (thème sombre, 12 langues)
apps/api/          # Backend NestJS
packages/shared-types/  # Types partagés entre frontend et backend
docs/              # STRATEGY_SPEC.md (spéc. stratégie) · ARCHITECTURE.md (mapping des composants)
docker-compose.yml # Infrastructure par défaut ; --profile full pour la pile complète
```

**Machine à états de la stratégie** : `TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`, `RUNNING` peut bifurquer vers `TAKE_PROFIT` ; les branches d'exploitation comprennent `PAUSED` (réinitialisable via `USER_RESUME`), `CANCELLED`, `HOLD`.

**Commandes de développement** :

```bash
pnpm dev          # démarre tous les services en une commande
pnpm build        # compilation
pnpm test         # tests
pnpm lint         # Lint
```

**Base de données** (développement local) :

```bash
cd apps/api
pnpm prisma migrate dev    # exécute les migrations
pnpm prisma studio         # visualise les données
```

## Index de la documentation

| Document | Description |
|------|------|
| [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md) | Explication complète des innovations clés (comparaison point par point avec la grille native) |
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | Spécification complète de la stratégie (référence faisant autorité) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Index de correspondance entre les composants de code et les chapitres de la spécification |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | Explication des frais et des frais de financement |
