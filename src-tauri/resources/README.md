# Recursos embarcados do Nexus Launcher

Esta pasta é populada **automaticamente pelo CI** (`.github/workflows/build.yml`,
job `prepare`) antes do `tauri build`. Não edite à mão — ela é regenerada a
cada build.

Estrutura esperada após o CI:

```
resources/
├── jre/
│   ├── mac/   → JRE 21 Temurin (aarch64)  [bundle Mac]
│   └── win/   → JRE 21 Temurin (x64)       [bundle Windows]
├── prism/
│   ├── mac/   → PrismLauncher.app (portable) [bundle Mac]
│   └── win/   → PrismLauncher.exe (portable) [bundle Windows]
├── minecraft/
│   ├── versions/1.20.1-forge-47.4.21/  → cliente Forge já instalado
│   └── libraries/                          → libs do Forge/Minecraft
└── forge-patch/
    └── net.minecraftforge.json  → patch OneSix local (dispensa rede de metadata)
```

O `install_game` (Rust) copia estes recursos para a pasta gerenciada do
usuário (`~/Library/Application Support/NexusLauncher` no Mac,
`%APPDATA%/nexusLauncher` no Windows) e cria a instância do Prism. O
`play_game` roda o Prism embarcado em CLI headless (`--launch nexus
--offline NexusPlayer`), que cuida do module-path do Forge, do jar universal,
dos natives e baixa os assets no primeiro launch.

`server.dat` é gerado em runtime apontando para
`fine-minus.gl.joinmc.link:25565` (online-mode=false é config do servidor).
