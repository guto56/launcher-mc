# Launcher MC — Instalador de Mods (Tauri + painel-mc)

Launcher nativo multiplataforma (Windows + macOS) para **instalar/atualizar os mods
do servidor painel-mc automaticamente**, baixando **só o que falta ou está
desatualizado**. Interface roxa/glassmorphism idêntica ao site
[https://painel-mc.centralchamados.xyz](https://painel-mc.centralchamados.xyz).

> Tauri (Rust + WebView nativa) → binário ~10 MB, baixo consumo, tema 100% reaproveitado.

---

## O que ele faz

1. **Detecta** a pasta de mods do Minecraft do usuário:
   - Windows: `%APPDATA%\.minecraft\mods` (ou `versions\<ver>\mods` mais recente)
   - macOS: `~/Library/Application Support/minecraft/mods` (ou `versions/<ver>/mods`)
2. **Consome** `GET /api/mods` e `GET /api/status` do painel.
3. **Compara** mods do servidor vs. locais (nome + versão semântica).
4. Mostra a lista com badges: `✓ instalado` / `＋ faltando` / `↑ desatualizado`.
5. Botão **"Instalar tudo" / "Atualizar"** baixa **apenas** os pendentes, um a um
   (paralelismo de 4, com retry de 2×), via `GET /api/mods/file/:filename`.
6. Barra de progresso animada + status do servidor (badge online/offline + jogadores).

---

## Estrutura

```
launcher-mc/
├── src/                      # Frontend (web) — tema roxo/glass
│   ├── index.html
│   ├── styles/{theme,glass,animations}.css
│   └── js/{api,mods,fs,ui,main}.js
├── src-tauri/                # Backend Rust (Tauri v2)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── build.rs
│   ├── icons/{32x32.png,128x128.png,icon.ico,icon.icns}
│   └── src/{main.rs,lib.rs,commands.rs,download.rs}
├── .github/workflows/build.yml   # CI: gera .msi/.exe (Win) e .dmg (Mac)
├── package.json
└── README.md
```

### Comandos Rust expostos à webview

| Comando | Descrição |
|---|---|
| `detect_mods_dir()` | Resolve (e cria) a pasta de mods do SO. |
| `list_local_mods(dir)` | Lista `{file, name, version, size}` dos jars locais. |
| `save_mod(dir, filename, bytes)` | Grava o jar baixado na pasta (basename p/ segurança). |
| `open_minecraft_folder(path)` | Abre o explorador na pasta (UX). |
| `download_mod(filename)` | Baixa o jar da rota `/api/mods/file/:filename`. |
| `base_url()` | URL base da API do painel. |

---

## Rota nova no backend do painel (`/api/mods/file/:filename`)

Adicionada em `projects/painel-mc/server.js`. Faz **stream** do jar individual da
pasta `mods/` do servidor usando `path.basename()` para bloquear *path traversal*,
com checagem extra de que o caminho resolvido fica dentro de `MODS_DIR`. Retorna
`404` se o arquivo não existir.

```js
app.get('/api/mods/file/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const filePath = path.join(MODS_DIR, safe);
  const resolved = path.resolve(filePath);
  const modsRoot = path.resolve(MODS_DIR);
  if (resolved !== modsRoot && !resolved.startsWith(modsRoot + path.sep)) {
    return res.status(400).json({ ok: false, error: 'Caminho inválido.' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return res.status(404).json({ ok:false, error:'Mod não encontrado.', file: safe });
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    fs.createReadStream(filePath).pipe(res);
  });
});
```

**Validação (curl real, servidor local na porta 8099):**
```text
GET /api/mods/file/fabric-api-0.155.2+26.2.jar  -> HTTP 200, 2.530.080 bytes (jar idêntico ao do disco)
GET /api/mods/file/naoexiste.jar                -> HTTP 404 {error:"Mod não encontrado."}
GET /api/mods/file/..%2f..%2fserver.js          -> HTTP 404 (traversal bloqueado)
```

---

## Como rodar em desenvolvimento

```bash
cd launcher-mc
npm install
npm run dev        # abre Vite (modo preview da UI; usa fallback JS para os comandos Rust)
```

> Em `npm run dev` (fora do Tauri) os comandos Rust caem num *fallback* em
> `localStorage` + `fetch` para que a UI seja validável no browser. O build
> real do binário usa os comandos Rust.

Para rodar **dentro do Tauri** (precisa de Rust):

```bash
npm run tauri dev
```

---

## Como gerar os binários (Windows .msi/.exe e macOS .dmg)

### Opção A — Local (precisa da toolchain do SO alvo)

**Pré-requisitos:** Node 22+, Rust (`rustup`), e no alvo:
- Windows: WebView2 Runtime (já no Win11).
- macOS: Xcode Command Line Tools + certificado Apple para assinar/notarizar.

```bash
# Windows (x64)
npm run tauri build
# Saída: src-tauri/target/release/bundle/msi/*.msi e (nsis) *.exe

# macOS (Apple Silicon)
npm run tauri build -- --target aarch64-apple-darwin
# macOS (Intel)
npm run tauri build -- --target x86_64-apple-darwin
# Saída: src-tauri/target/<target>/release/bundle/dmg/*.dmg
```

> ⚠️ **Cross-compile de MSI a partir do Linux não é suportado.** O `.exe` final
> deve ser gerado em Windows ou via CI.

### Opção B — GitHub Actions (recomendado)

O workflow `.github/workflows/build.yml` gera automaticamente:
- Job `build-windows` (runner `windows-latest`) → artifact `.msi`/`.exe`.
- Job `build-macos` (runner `macos-latest`, matrix Intel + Apple Silicon) → `.dmg`.
- Job `release` → solta os binários numa release quando você cria uma tag `v*`.

```bash
git tag v1.0.0 && git push origin v1.0.0
# ou dispara manualmente em Actions > Build Launcher MC > Run workflow
```

Secrets opcionais no repo (para macOS assinado/notarizado):
`APPLE_CERT_P12`, `APPLE_CERT_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_SIGN_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, e `LAUNCHER_API_BASE` para apontar a
API do painel (default: `https://painel-mc.centralchamados.xyz`).

---

## Observações

- A comparação de versão é por **semântica simples** (split numérico em `.`/`-`/`+`);
  se empatar, compara string bruta (ex.: `1.0.0` vs `1.0.0-beta`).
- Download em paralelo limitado a 4 com `Promise.allSettled` + retry de 2× por arquivo.
- Pós-download: `save_mod` valida extensão `.jar` e o `download_mod` confere tamanho > 0.
- Tema roxo/glass reusa as variáveis CSS e o `backdrop-filter` do site painel-mc;
  a webview (WebKit/WebView2) renderiza o blur nativamente.
