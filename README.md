# Discord REA

Clone pessoal no estilo Discord, feito com Electron + Node.js, focado em **transmissão de tela em alta qualidade** (1080p/1440p/4K a até 60 FPS) para duas pessoas.

## Como rodar (localhost)

```bash
npm install
npm run server      # terminal 1: servidor em ws://localhost:3478 (ou: docker compose up)
npm start           # terminal 2: abre o app
```

Para testar sozinho com duas contas no mesmo PC, abra uma segunda instância com outro perfil:

```bash
npx electron . --dev --user-data-dir=%TEMP%\rea-perfil2
```

## Contas e convites

Não existe cadastro aberto: cada pessoa precisa de um **código de convite de uso único**, que você gera pela API de admin.

1. Gere o convite e envie para a pessoa (`REA_ADMIN_TOKEN` fica no `.env`; no Docker de dev é `dev-admin-token`):
   ```bash
   curl -X POST https://discord.gendata.tech/api/admin/invites      -H "Authorization: Bearer $REA_ADMIN_TOKEN" -H "content-type: application/json"      -d '{"note": "convite do Joao"}'
   # => {"code":"K7PM-2XQA-9HDF","note":"convite do Joao","createdAt":...,"usedAt":null,"usedBy":null}
   ```
2. No app, a pessoa clica em **Registre-se**, informa o código e o nome de usuário, clica em **Continuar** e define **senha** e **confirmar senha** (mínimo 8 caracteres). O convite deixa de valer.
3. Depois disso, ela entra só com **nome de usuário e senha**.

| Rota | Para quê |
|---|---|
| `POST /api/admin/invites` | Cria convite. Body opcional: `{"note": "...", "count": 5}` (até 50 de uma vez) |
| `GET /api/admin/invites` | Lista convites, com quem usou cada um |
| `GET /api/admin/stats` | Usuários, online, mensagens, uso da cota de anexos, memória |
| `DELETE /api/admin/invites/CODIGO` | Revoga um convite ainda não usado |
| `POST /api/invites/check` | (app) Valida convite + nome sem gastar o convite |
| `POST /api/register` | (app) Cria a conta e gasta o convite |
| `POST /api/login` | (app) Nome + senha → token da sessão |

Senhas são guardadas com hash `scrypt`; o app guarda só o token da sessão, nunca a senha. Após 10 tentativas erradas (login ou convite) em 15 min, o IP fica bloqueado temporariamente.

## O que já funciona

- Servidores, canais de texto e de voz (criar/excluir), lista de membros com status (disponível/ausente/não perturbar/invisível)
- Chat: markdown (**negrito**, *itálico*, `código`, blocos, spoiler `||x||`, citação, links, @menções), editar (↑ ou botão), excluir, responder, reações, emojis, "digitando...", histórico com rolagem infinita, anexos (colar/arrastar imagens e arquivos até 50 MB), notificações e contador de não lidas
- Voz: entrar/sair, silenciar (Ctrl+Shift+M), desativar áudio (Ctrl+Shift+D), indicador de quem está falando, volume por usuário até 200% e "silenciar só para mim" (botão direito)
- Voz e vídeo (mesmas opções do Discord, levantadas no `discord_voice.node` com REA):
  - Supressão de ruído **IA (RNNoise)** / Padrão / Nenhum. O RNNoise é o equivalente open source do Krisp e roda num AudioWorklet (thread de áudio). Medido: -80 dB em ruído constante
  - Cancelamento de eco, controle automático de ganho
  - **Detecção de voz** com sensibilidade automática (acompanha o ruído do ambiente) ou manual, com medidor ao vivo. O microfone é realmente cortado abaixo da sensibilidade
  - **Detecção avançada de voz**: a IA só abre o microfone para voz humana
  - **Pressionar para falar** global (funciona dentro de jogos), com tecla ou botão lateral do mouse e atraso ao soltar
  - Volume de entrada e de saída (até 200%), teste de microfone ("Vamos checar")
  - Avisos de "Você está silenciado" e de microfone sem som
  - Qualidade de serviço com prioridade alta de pacotes, Opus a 128 kbps
- Câmera em 1080p
- **Go Live**: seletor de tela/janela, 720p / 1080p / 1440p / 4K / Fonte, 15/30/60 FPS, codec H264/VP9/AV1/H265, áudio do sistema, modo Fluidez/Nitidez, tela cheia, estatísticas ao vivo (resolução, FPS, Mbps, codec, decoder)
- Janela sem moldura, bandeja do sistema, instância única

## Como a transmissão foi otimizada

| Item | Discord (grátis) | Discord REA |
|---|---|---|
| Resolução | 720p | até 4K / nativa |
| FPS | 30 | até 60 |
| Bitrate máx. | ~2–4 Mbps | 12 Mbps (1080p) • 20 (1440p) • 35 (4K) |
| Caminho | servidor do Discord | **P2P direto** (sem servidor de mídia no meio) |

- Encoder por hardware: H264 usa NVENC/AMF/QuickSync via Media Foundation (testado: `NVIDIA H.264 Encoder MFT`, CPU ~0%) e decoder D3D11.
- Resolução travada por padrão (`maintain-resolution`): o Full HD não cai para 720p. O modo **Fluidez** troca isso por FPS estável.
- SDP ajustado para o bitrate começar alto (`x-google-start-bitrate`) e Opus estéreo a 128 kbps.
- O Chromium não reduz a captura com a janela em segundo plano.

Na prática, o limite é o **upload da internet** de quem transmite: 1080p60 fica bom a partir de ~15 Mbps de upload.

## Análise do Discord original (REA)

Analisei `%LOCALAPPDATA%\Discord\app-1.0.9265` com o REA:

- `resources/app.asar` é o bootstrap/atualizador (webpack, ~977 módulos).
- `modules/discord_desktop_core-1/core.asar` contém o processo principal (`bundle.js`) e o preload (`mainScreenPreload.js`, que expõe uma API via `contextBridge`).
- O módulo da janela principal exporta `WEBAPP_ENDPOINT`: **a interface do Discord não fica no seu PC**, ela é carregada do site do Discord. Por isso não dá para "copiar" a interface, e ela foi reescrita do zero aqui (layout e cores no estilo do Discord, sem código nem logos proprietários).
- A voz/vídeo do Discord usa módulos nativos próprios (`discord_voice`, `discord_media`). Aqui usamos o WebRTC do Chromium, que já tem encoder por hardware.

## Produção (VPS)

O passo a passo completo de deploy está em [`deploy/DEPLOY.md`](deploy/DEPLOY.md). Em resumo:

- O app instalado conecta sempre em `wss://discord.gendata.tech`, e o campo de endereço fica escondido. Com `npm run dev` ele aparece com `ws://localhost:3478`. Para apontar para outro servidor sem recompilar, use `REA_SERVER=wss://outro npm start`.
- Na VPS tudo roda em Docker e cada projeto tem o seu nginx. Um roteador de borda neutro (`deploy/edge`, HAProxy) fica com as portas 80/443 e só repassa cada domínio ao nginx do projeto certo, sem abrir o HTTPS.
- O servidor usa **SQLite** (`server/data/rea.db`, dentro do volume Docker). Um `db.json` de versões antigas é importado automaticamente na primeira execução.
- Vídeo e tela vão **P2P**. Quem transmite só envia a tela para quem clicou em **Assistir**.
- Se o P2P falhar (CGNAT), o app usa o **TURN** (coturn) da VPS com credencial temporária, e a transmissão para essa pessoa fica limitada a **720p30 / 2,5 Mbps** para não sobrecarregar a VPS.

## Limitações conhecidas

- Áudio do sistema na transmissão captura o som do PC inteiro. Se o Chromium não conseguir excluir o áudio do próprio app (`restrictOwnAudio`), seu amigo pode ouvir o eco da própria voz enquanto você transmite com som. Nesse caso, transmita uma janela sem áudio ou use outra saída de áudio para a call.
- Krisp em si é proprietário (licenciado pelo Discord); no lugar dele usamos o RNNoise.
- "Atenuação" (o Discord baixa o volume de outros apps enquanto alguém fala) ainda não existe: exige integração nativa com o mixer do Windows.
- Ainda não tem: mensagens diretas (DM), cargos/permissões, convites, edição de avatar, overlay em jogos.
