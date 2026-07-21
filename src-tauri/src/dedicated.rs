//! Nexus Launcher dedicado / autossuficiente.
//!
//! Em vez de depender do Java do sistema, de um installer do Forge em runtime
//! ou de um launcher externo, tudo vem dos RECURSOS EMBARCADOS no bundle
//! (preparados no CI em `src-tauri/resources/` -> `<resource_dir>/resources/`):
//!
//! - `resources/jre/`        -> JRE 21 (Temurin, aarch64/x64 por plataforma)
//! - `resources/minecraft/` -> Minecraft 1.20.1 + Forge 47.4.21 já instalado
//!                             (versions/, libraries/ gerados pelo installer no CI)
//! - `resources/prism/`     -> PrismLauncher portable (base p/ auth offline)
//! - `resources/forge-patch/net.minecraftforge.json` -> patch OneSix local do
//!                             Forge (evita depender da rede de metadata do Prism)
//!
//! `install_game` copia esses recursos da pasta de recursos do app para a
//! pasta gerenciada do Nexus de forma idempotente e cria a INSTÂNCIA do
//! Prism (instance.cfg + patch local + server.dat).
//!
//! `play_game` roda o Prism embarcado em modo CLI headless apontando para a
//! instância criada. O Prism cuida do module-path do Forge, do jar universal,
//! dos natives e baixa os assets no primeiro launch. Sem Java do sistema, sem
//! installer em runtime, sem launcher externo.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const VERSION_ID: &str = "1.20.1-forge-47.4.21";
const SERVER_ADDRESS: &str = "fine-minus.gl.joinmc.link";
const SERVER_PORT: u16 = 25565;
const INSTANCE_NAME: &str = "nexus";
const OFFLINE_USER: &str = "NexusPlayer";

const MANAGED_DIR: &str = if cfg!(target_os = "windows") {
    "nexusLauncher"
} else if cfg!(target_os = "macos") {
    "NexusLauncher"
} else {
    "nexuslauncher"
};

/// Status retornado pelo `install_game` (usado na barra de progresso do wizard).
#[derive(Debug, Clone, Serialize)]
pub struct InstallStatus {
    pub done: bool,
    pub message: String,
    pub progress: u8,
}

/// Evento de progresso emitido durante o `install_game` (ouvido no frontend).
#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub progress: u8,
    pub message: String,
}

/// Resultado do `play_game`.
#[derive(Debug, Clone, Serialize)]
pub struct LaunchResult {
    pub launched: bool,
    pub message: String,
}

// =============================================================================
// Resolução de pastas
// =============================================================================

/// Pasta gerenciada do Nexus (jre/, prism/, instances/, .minecraft/).
fn nexus_data_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .ok()
            .map(|a| PathBuf::from(a).join(MANAGED_DIR))
    } else if cfg!(target_os = "macos") {
        dirs::data_dir().map(|d| d.join(MANAGED_DIR))
    } else {
        dirs::data_dir().map(|d| d.join(MANAGED_DIR))
    }
}

/// Resolve a pasta de recursos embarcada no bundle do app.
fn embedded_resources(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|e| format!("Não foi possível resolver a pasta de recursos: {e}"))
        .map(|p| p.join("resources"))
}

/// Executável do Prism embarcado (por plataforma).
fn embedded_prism(data: &Path) -> PathBuf {
    let base = data.join("prism");
    if cfg!(target_os = "macos") {
        base.join("PrismLauncher.app")
            .join("Contents")
            .join("MacOS")
            .join("PrismLauncher")
    } else if cfg!(target_os = "windows") {
        base.join("PrismLauncher.exe")
    } else {
        base.join("prismlauncher")
    }
}

/// Executável do Java embarcado (usado só para validação; o Prism usa via instance.cfg).
fn embedded_java(data: &Path) -> PathBuf {
    let mut p = data.join("jre").join("bin").join("java");
    if cfg!(target_os = "windows") {
        p.set_extension("exe");
    }
    p
}

/// Subpasta de plataforma dentro de `resources/{jre,prism}` (CI baixa por target).
fn platform_subdir() -> &'static str {
    if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "win"
    } else {
        "linux"
    }
}

// =============================================================================
// Helpers de cópia / progresso
// =============================================================================

fn emit_progress(app: &AppHandle, progress: u8, msg: &str) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            progress,
            message: msg.to_string(),
        },
    );
}

/// Copia um diretório recursivamente (arquivos e subdiretórios).
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Falha ao criar {}: {e}", dst.display()))?;
    let read = std::fs::read_dir(src)
        .map_err(|e| format!("Falha ao ler {}: {e}", src.display()))?;
    for entry in read.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else if path.is_file() {
            std::fs::copy(&path, &target)
                .map_err(|e| format!("Falha ao copiar {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Copia um recurso embarcado (arquivo ou diretório) para o destino.
fn copy_resource(
    app: &AppHandle,
    rel: &str,
    dest: &Path,
    progress: u8,
    msg: &str,
) -> Result<(), String> {
    let res = embedded_resources(app)?;
    let src = res.join(rel);
    if !src.exists() {
        return Err(format!(
            "Recurso embarcado ausente: resources/{rel}. O app foi construído sem os recursos do Nexus?"
        ));
    }
    if src.is_dir() {
        copy_dir(&src, dest)?;
    } else {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&src, dest).map_err(|e| format!("Falha ao copiar {rel}: {e}"))?;
    }
    emit_progress(app, progress, msg);
    Ok(())
}

// =============================================================================
// server.dat (NBT) — aponta para o servidor do Nexus
// =============================================================================

/// Gera `server.dat` (NBT binário) apontando para o servidor do Nexus.
fn write_server_dat(mc_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(mc_dir).map_err(|e| e.to_string())?;
    let path = mc_dir.join("server.dat");
    let bytes = build_server_dat_nbt(SERVER_ADDRESS, SERVER_PORT);
    std::fs::write(&path, bytes).map_err(|e| format!("Falha ao gravar server.dat: {e}"))?;
    Ok(())
}

/// Constrói um `server.dat` (NBT) mínimo com um único servidor.
fn build_server_dat_nbt(ip: &str, port: u16) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x0A); // TAG_Compound raiz
    write_nbt_string(&mut buf, "");

    buf.push(0x0A); // TAG_Compound "servers"
    write_nbt_string(&mut buf, "servers");

    buf.push(0x0A); // TAG_Compound (entrada, nome vazio)
    write_nbt_string(&mut buf, "");

    buf.push(0x08); // TAG_String "ip"
    write_nbt_string(&mut buf, "ip");
    write_nbt_string(&mut buf, &format!("{ip}:{port}"));

    buf.push(0x08); // TAG_String "name"
    write_nbt_string(&mut buf, "name");
    write_nbt_string(&mut buf, "Nexus");

    buf.push(0x01); // TAG_Byte "acceptTextures"
    write_nbt_string(&mut buf, "acceptTextures");
    buf.push(0x01);

    buf.push(0x00); // fim do compound de servidor
    buf.push(0x00); // fim do compound "servers"
    buf.push(0x00); // fim do compound raiz
    buf
}

/// Escreve uma String NBT: u16 length (BE) + bytes UTF-8.
fn write_nbt_string(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    buf.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    buf.extend_from_slice(bytes);
}

// =============================================================================
// Instância do Prism
// =============================================================================

/// Cria a instância do Prism em <data>/instances/nexus/ com:
/// - instance.cfg (OneSix, JavaPath = JRE embarcado, server no launch)
/// - patches/net.minecraftforge.json (patch local do Forge, sem rede)
/// - .minecraft/server.dat (servidor do Nexus)
fn create_prism_instance(data: &Path, app: &AppHandle) -> Result<(), String> {
    let inst = data.join("instances").join(INSTANCE_NAME);
    std::fs::create_dir_all(&inst).map_err(|e| e.to_string())?;

    // instance.cfg (formato QSettings IniFormat do Prism)
    let jre = embedded_java(data);
    let jre = jre.to_string_lossy().replace('\\', "/");
    let server_addr = format!("{SERVER_ADDRESS}:{SERVER_PORT}");
    let cfg = format!(
        "[General]\n\
         name=Nexus MC\n\
         InstanceType=OneSix\n\
         iconKey=default\n\
         notes=Instancia gerenciada pelo Nexus Launcher\n\
         lastLaunch=0\n\
         totalTime=0\n\
         JavaPath={jre}\n\
         JoinServerOnLaunch=true\n\
         JoinServerOnLaunchAddress={server_addr}\n\
         OverrideMemory=true\n\
         MinMemAlloc=2048\n\
         MaxMemAlloc=4096\n"
    );
    let mut f = std::fs::File::create(inst.join("instance.cfg"))
        .map_err(|e| format!("Falha ao criar instance.cfg: {e}"))?;
    f.write_all(cfg.as_bytes())
        .map_err(|e| format!("Falha ao escrever instance.cfg: {e}"))?;

    // patch local do Forge (copiado do recurso embarcado no CI)
    let res = embedded_resources(app)?;
    let patch_src = res.join("forge-patch").join("net.minecraftforge.json");
    let patch_dst = inst.join("patches").join("net.minecraftforge.json");
    if patch_src.is_file() {
        std::fs::create_dir_all(patch_dst.parent().unwrap()).ok();
        std::fs::copy(&patch_src, &patch_dst)
            .map_err(|e| format!("Falha ao copiar patch do Forge: {e}"))?;
    }
    // Se o CI não gerou o patch, o Prism tentará baixar da rede (ainda funciona
    // com internet; o patch só elimina a dependência de rede).

    // server.dat na pasta .minecraft da instância
    write_server_dat(&inst.join(".minecraft"))?;
    Ok(())
}

// =============================================================================
// install_game: copia recursos + cria instância (idempotente)
// =============================================================================

#[tauri::command]
pub async fn install_game(app: AppHandle) -> Result<InstallStatus, String> {
    let data = nexus_data_dir().ok_or_else(|| {
        "Não foi possível resolver a pasta do Nexus Launcher neste SO.".to_string()
    })?;

    // Idempotência: JRE + instância já existem?
    let marker = data.join("nexus-installed.json");
    let java_bin = embedded_java(&data);
    if marker.is_file() && java_bin.exists() && data.join("instances").join(INSTANCE_NAME).is_dir() {
        return Ok(InstallStatus {
            done: true,
            progress: 100,
            message: "Jogo do Nexus já preparado.".to_string(),
        });
    }

    std::fs::create_dir_all(&data).map_err(|e| format!("Falha ao criar pasta do Nexus: {e}"))?;
    emit_progress(&app, 5, "Iniciando preparação do jogo…");

    // 1) JRE 21 embarcado (só a subpasta da plataforma atual)
    copy_resource(
        &app,
        &format!("jre/{}", platform_subdir()),
        &data.join("jre"),
        25,
        "Copiando Java (JRE 21)…",
    )?;

    // 2) Minecraft + Forge 1.20.1 já instalado (versions/ + libraries/)
    copy_resource(
        &app,
        "minecraft",
        &data.join(".minecraft"),
        65,
        "Copiando Minecraft + Forge 1.20.1…",
    )?;

    // 3) PrismLauncher portable (só a subpasta da plataforma atual)
    copy_resource(
        &app,
        &format!("prism/{}", platform_subdir()),
        &data.join("prism"),
        85,
        "Copiando launcher de apoio (Prism)…",
    )?;

    // 4) Cria a instância do Prism + server.dat
    create_prism_instance(&data, &app)?;
    emit_progress(&app, 95, "Configurando instância do servidor…");

    // 5) Marca de instalação concluída
    let manifest = serde_json::json!({
        "version": VERSION_ID,
        "server": SERVER_ADDRESS,
        "installedAt": chrono_now(),
    });
    std::fs::write(
        &marker,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| format!("Falha ao gravar manifest do Nexus: {e}"))?;

    emit_progress(&app, 100, "Pronto! Você já pode jogar.");
    Ok(InstallStatus {
        done: true,
        progress: 100,
        message: "Jogo do Nexus preparado com sucesso.".to_string(),
    })
}

/// ISO local simples (sem crate chrono).
fn chrono_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{secs}")
}

// =============================================================================
// play_game: roda o Prism embarcado em CLI headless
// =============================================================================

#[tauri::command]
pub async fn play_game(app: AppHandle) -> Result<LaunchResult, String> {
    let data = nexus_data_dir().ok_or_else(|| {
        "Não foi possível resolver a pasta do Nexus Launcher neste SO.".to_string()
    })?;

    let prism = embedded_prism(&data);
    if !prism.exists() {
        return Err(
            "PrismLauncher não encontrado. Rode a preparação do jogo (Passo 4) antes de jogar."
                .to_string(),
        );
    }

    let instance_dir = data.join("instances").join(INSTANCE_NAME);
    if !instance_dir.is_dir() {
        return Err(
            "Instância do Nexus não encontrada. Rode a preparação do jogo (Passo 4) antes de jogar."
                .to_string(),
        );
    }

    // Prism CLI: --launch <id> --dir <datadir> --offline <user>
    // O id da instância = nome da pasta (INSTANCE_NAME).
    // --dir aponta o data dir do Prism para a nossa pasta gerenciada.
    let mut cmd = Command::new(&prism);
    cmd.arg("--launch")
        .arg(INSTANCE_NAME)
        .arg("--dir")
        .arg(&data)
        .arg("--offline")
        .arg(OFFLINE_USER);

    // No macOS o app é um bundle; precisamos rodar a partir do diretório
    // correto para resolver recursos relativos do Prism.
    if let Some(parent) = prism.parent() {
        cmd.current_dir(parent);
    }

    #[cfg(target_os = "windows")]
    {
        // No Windows o Prism portable precisa do working dir = pasta do exe.
        if let Some(parent) = prism.parent() {
            cmd.current_dir(parent);
        }
    }

    let _ = cmd.spawn().map_err(|e| format!("Falha ao iniciar o jogo: {e}"))?;

    Ok(LaunchResult {
        launched: true,
        message: "Jogo iniciado! O Minecraft vai abrir em instantes.".to_string(),
    })
}
