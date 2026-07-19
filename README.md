# Launcher MC Silicon

Launcher nativo em Tauri v2 para macOS Apple Silicon. Ele detecta a pasta de mods,
consulta o status e a lista de mods do servidor, compara com os jars locais e
baixa apenas o necessário via `/api/mods/file/:filename`.

## O que faz

- Detecta `~/Library/Application Support/minecraft/mods`
- Lista os mods locais `.jar`
- Usa `reqwest` no Rust para consultar `GET /api/mods` e `GET /api/status`
- Baixa somente os mods faltantes ou desatualizados
- UI minimalista com status, pasta detectada, lista de mods, progresso e erro visível
- `LAUNCHER_API_BASE` define a URL base da API

## Estrutura

```text
launcher-mac-silicon/
├── src/                      # frontend minimalista
│   ├── index.html
│   ├── styles/theme.css
│   └── js/{api,fs,mods,ui,main}.js
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── permissions/*.toml
│   └── src/{main.rs,lib.rs,commands.rs,download.rs}
├── .github/workflows/build.yml
├── package.json
└── build-frontend.cjs
```

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

## Instalação no macOS Silicon

O binário é compilado apenas para **Apple Silicon** (`aarch64-apple-darwin`).
Como não há assinatura/notarização (sem Apple Developer ID), o Gatekeeper pode
bloquear o app com *"Launcher MC está danificado e não pode ser aberto"*. Isso **não**
é um erro de build — é a ausência de code-signing. Para abrir:

1. Mova o `.dmg` para Aplicativos e monte/instale o app em
   `/Applications/Launcher MC Silicon.app`.
2. No Terminal, remova o atributo de quarantena:

   ```bash
   xattr -cr "/Applications/Launcher MC Silicon.app"
   ```

3. Faça **botão direito (ou Control+Click)** sobre o app e escolha **Abrir** →
   confirme em *"Abrir mesmo assim"*. (O duplo-clique direto pode continuar
   bloqueando; o botão direito contorna o Gatekeeper na primeira abertura.)

Após esse primeiro procedimento, o app abre normalmente com duplo-clique.

## Observação

Este projeto foi ajustado para **macOS Silicon only**. Não há alvo Intel/Windows no
bundle nem no workflow.
