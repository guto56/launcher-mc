//! Comandos expostos à webview do Tauri (ponte JS <-> Rust).
//!
//! - `detect_mods_dir`   -> resolve a pasta de mods do Minecraft (win/mac)
//! - `list_local_mods`   -> lista {file, name, version, size} dos jars locais
//! - `save_mod`          -> grava um jar baixado na pasta detectada
//! - `open_minecraft_folder` -> abre o explorador na pasta (UX)
//! - `download_mod`      -> baixa um jar da rota /api/mods/file/:filename
//! - `base_url`          -> URL base da API do painel

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// Representação de um mod local (para a UI comparar com o servidor).
#[derive(Debug, Clone, Serialize)]
pub struct LocalMod {
    pub file: String,
    pub name: String,
    pub version: String,
    pub size: u64,
}

/// Resultado da detecção da pasta de mods.
#[derive(Debug, Clone, Serialize)]
pub struct ModsDirInfo {
    /// Caminho resolvido da pasta de mods.
    pub path: String,
    /// true se a pasta já existia; false se foi criada agora.
    pub created: bool,
    /// true se é o padrão (.minecraft/mods); false se caiu em versions/<ver>/mods.
    pub is_standard: bool,
}

/// Versão do Forge (mcversion-forgeversion), confirmada no servidor.
const FORGE_VERSION: &str = "1.20.1-47.4.21";

/// URL base do installer do Forge (maven.minecraftforge.net).
/// `{ver}` é substituído por `FORGE_VERSION` (ex.: 1.20.1-47.4.21).
fn forge_installer_url() -> String {
    format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{ver}/forge-{ver}-installer.jar",
        ver = FORGE_VERSION
    )
}

/// URL base da API do painel (configurável via env LAUNCHER_API_BASE).
fn api_base() -> String {
    std::env::var("LAUNCHER_API_BASE")
        .unwrap_or_else(|_| "https://painel-mc.centralchamados.xyz".to_string())
}

/// Extrai nome + versão a partir do nome do arquivo (ex.: fabric-api-0.155.2.jar).
fn parse_mod_meta(filename: &str) -> (String, String) {
    let base = filename.trim_end_matches(".jar").trim_end_matches(".JAR");
    let re = regex_lite(base);
    if let Some((name, version)) = re {
        (name, version)
    } else {
        (base.to_string(), String::new())
    }
}

/// Parser simples: separa "nome" de "versão" no final do nome do arquivo.
/// Evita dependência de crate de regex — faz split manual no último '-' ou '_'
/// que antecede algo parecido com versão (dígitos).
fn regex_lite(base: &str) -> Option<(String, String)> {
    // Procura o último separador antes de uma sequência que comece com dígito.
    let bytes = base.as_bytes();
    let mut idx = None;
    for i in (1..bytes.len()).rev() {
        let c = bytes[i];
        if (c == b'-' || c == b'_') && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit() {
            idx = Some(i);
            break;
        }
    }
    idx.map(|i| {
        let name = base[..i].replace(['-', '_'], " ").trim().to_string();
        let version = base[i + 1..].to_string();
        (name, version)
    })
}

/// Resolve a pasta padrão de mods conforme o SO.
fn standard_mods_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Some(PathBuf::from(appdata).join(".minecraft").join("mods"));
        }
        None
    } else if cfg!(target_os = "macos") {
        dirs::data_dir().map(|d| d.join("minecraft").join("mods"))
    } else {
        // Linux (dev / Steam Deck): usar XDG ou fallback padrão.
        dirs::data_dir().map(|d| d.join(".minecraft").join("mods"))
    }
}

/// Procura a pasta de mods mais recente em versions/<ver>/mods (launchers
/// multi-instância / Forge). Retorna None se não houver.
fn latest_versioned_mods_dir(minecraft_dir: &Path) -> Option<PathBuf> {
    let versions = minecraft_dir.join("versions");
    let read = std::fs::read_dir(&versions).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in read.flatten() {
        let mods = entry.path().join("mods");
        if mods.is_dir() {
            if let Ok(meta) = std::fs::metadata(&mods) {
                if let Ok(modified) = meta.modified() {
                    match &best {
                        Some((t, _)) if *t >= modified => {}
                        _ => best = Some((modified, mods)),
                    }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Detecta (e cria, se necessário) a pasta de mods do Minecraft.
#[tauri::command]
pub fn detect_mods_dir() -> Result<ModsDirInfo, String> {
    let std_dir = standard_mods_dir()
        .ok_or_else(|| "Não foi possível resolver a pasta do Minecraft neste SO.".to_string())?;

    // 1) Pasta padrão existe? usa ela.
    if std_dir.is_dir() {
        return Ok(ModsDirInfo {
            path: std_dir.to_string_lossy().to_string(),
            created: false,
            is_standard: true,
        });
    }

    // 2) Pasta padrão não existe: tenta versions/<ver>/mods mais recente.
    let minecraft_dir = std_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(&std_dir);
    if let Some(v) = latest_versioned_mods_dir(minecraft_dir) {
        let created = !v.exists();
        if created {
            let _ = std::fs::create_dir_all(&v);
        }
        return Ok(ModsDirInfo {
            path: v.to_string_lossy().to_string(),
            created,
            is_standard: false,
        });
    }

    // 3) Nada encontrado: cria a pasta padrão.
    std::fs::create_dir_all(&std_dir)
        .map_err(|e| format!("Falha ao criar pasta de mods: {e}"))?;
    Ok(ModsDirInfo {
        path: std_dir.to_string_lossy().to_string(),
        created: true,
        is_standard: true,
    })
}

/// Lista os mods (.jar) presentes numa pasta local.
#[tauri::command]
pub fn list_local_mods(dir: String) -> Result<Vec<LocalMod>, String> {
    let path = PathBuf::from(&dir);
    if !path.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let read = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("jar")
            || p.extension().and_then(|e| e.to_str()) == Some("JAR")
        {
            let file = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let (name, version) = parse_mod_meta(&file);
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            out.push(LocalMod {
                file,
                name,
                version,
                size,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Grava o conteúdo de um mod (bytes) na pasta informada, com o nome informado.
/// Usa path.basename para evitar traversal — só o nome do arquivo é aceito.
#[tauri::command]
pub fn save_mod(dir: String, filename: String, contents: Vec<u8>) -> Result<String, String> {
    let safe = Path::new(&filename)
        .file_name()
        .ok_or_else(|| "Nome de arquivo inválido.".to_string())?
        .to_string_lossy()
        .to_string();
    if !safe.to_lowercase().ends_with(".jar") {
        return Err("Apenas arquivos .jar são permitidos.".to_string());
    }
    let dir_path = PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    let dest = dir_path.join(&safe);
    std::fs::write(&dest, &contents).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Abre a pasta no explorador de arquivos do SO (UX).
#[tauri::command]
pub fn open_minecraft_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Retorna a URL base da API do painel.
#[tauri::command]
pub fn base_url() -> String {
    api_base()
}

// =============================================================================
// Comandos de rede para o painel (via reqwest, fora da webview).
//
// `fetchServerMods()` e `fetchStatus()` no JS usavam `fetch()` da webview e
// falhavam com `load failed` no Tauri/macOS. Agora essas chamadas saem do
// binário Rust (mesmo caminho comprovado do `download_mod`), eliminando a
// dependência do `fetch` da WKWebView.
// =============================================================================

/// Representação de um mod exposto pelo painel (`/api/mods`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerMod {
    pub file: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub size: u64,
}

/// Resposta envelopada de `/api/mods` (`{count, mods}`).
#[derive(Debug, Clone, serde::Deserialize)]
struct ModsResponse {
    #[serde(default)]
    count: usize,
    #[serde(default)]
    mods: Vec<ServerMod>,
}

/// Status do servidor retornado por `/api/status`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerStatus {
    pub running: bool,
    #[serde(default)]
    pub pid: u32,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub public_ip: String,
    #[serde(default)]
    pub join_link: String,
    #[serde(default)]
    pub players_online: u32,
    #[serde(default)]
    pub players_max: u32,
    #[serde(default)]
    pub uptime_seconds: u64,
    #[serde(default)]
    pub motd: String,
    #[serde(default)]
    pub started_at: String,
}

/// Lista os mods exigidos pelo servidor (`GET /api/mods`).
///
/// Faz a requisição via reqwest (fora da webview) e retorna o array de mods.
#[tauri::command]
pub async fn server_mods() -> Result<Vec<ServerMod>, String> {
    let url = format!("{}/api/mods", api_base());

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .header("User-Agent", "LauncherMC/1.0 (Tauri)")
        .send()
        .await
        .map_err(|e| format!("Falha ao conectar no painel (mods): {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Servidor retornou status {} em /api/mods",
            resp.status()
        ));
    }

    let body = resp
        .json::<ModsResponse>()
        .await
        .map_err(|e| format!("Falha ao parsear JSON de /api/mods: {e}"))?;

    Ok(body.mods)
}

/// Consulta o status do servidor (`GET /api/status`).
#[tauri::command]
pub async fn server_status() -> Result<ServerStatus, String> {
    let url = format!("{}/api/status", api_base());

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .header("User-Agent", "LauncherMC/1.0 (Tauri)")
        .send()
        .await
        .map_err(|e| format!("Falha ao conectar no painel (status): {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Servidor retornou status {} em /api/status",
            resp.status()
        ));
    }

    resp.json::<ServerStatus>()
        .await
        .map_err(|e| format!("Falha ao parsear JSON de /api/status: {e}"))
}

// =============================================================================
// "Clicar e jogar": instalação automática do Forge + launch do Minecraft.
//
// - `ensure_forge(version)` -> baixa/roda o Forge Installer (idempotente),
//   mescla o perfil no launcher_profiles.json (sem sobrescrever perfis do
//   usuário; faz backup antes) e retorna LoaderStatus.
// - `launch_minecraft(profile)` -> marca o perfil como selecionado e abre o
//   Minecraft Launcher oficial (spawn, não bloqueia).
// =============================================================================

/// Status da instalação do loader (Fabric/Forge) retornado ao frontend.
#[derive(Debug, Clone, Serialize)]
pub struct LoaderStatus {
    /// true se o perfil do loader existe agora em versions/.
    pub installed: bool,
    /// Nome da pasta/perfil (ex.: "1.20.1-forge-47.4.21").
    pub profile: String,
    /// false => Java ausente; frontend deve orientar instalação.
    pub java_present: bool,
    /// Mensagem amigável de status.
    pub message: String,
}

/// Resolve a pasta raiz `.minecraft` conforme o SO.
/// Windows: %APPDATA%/.minecraft ; macOS: ~/Library/Application Support/minecraft
fn minecraft_root_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .ok()
            .map(|appdata| PathBuf::from(appdata).join(".minecraft"))
    } else if cfg!(target_os = "macos") {
        dirs::data_dir().map(|d| d.join("minecraft"))
    } else {
        // Linux (dev): fallback padrão.
        dirs::data_dir().map(|d| d.join(".minecraft"))
    }
}

/// Verifica se o Java está disponível (roda `java -version`).
fn java_present() -> bool {
    which_java()
        .map(|java| {
            std::process::Command::new(&java)
                .arg("-version")
                .output()
                .map(|o| o.status.success() || !o.stderr.is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Localiza o executável do Java. Tenta o PATH e caminhos comuns no Windows.
fn which_java() -> Option<String> {
    // 1) java no PATH
    if std::process::Command::new("java")
        .arg("-version")
        .output()
        .map(|o| o.status.success() || !o.stderr.is_empty())
        .unwrap_or(false)
    {
        return Some("java".to_string());
    }

    // 2) Windows: procurar em Program Files/Java/*/bin/java.exe
    #[cfg(target_os = "windows")]
    {
        for base in [
            "C:/Program Files/Java",
            "C:/Program Files/Eclipse Adoptium",
            "C:/Program Files (x86)/Java",
        ] {
            if let Ok(read) = std::fs::read_dir(base) {
                for entry in read.flatten() {
                    let cand = entry.path().join("bin").join("java.exe");
                    if cand.is_file() {
                        return Some(cand.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    None
}

/// Procura em `.minecraft/versions/` uma pasta cujo nome contenha `forge` e a
/// versão pedida (ex.: `1.20.1`). Retorna o nome da pasta se existir
/// (ex.: "1.20.1-forge-47.4.21").
fn find_forge_version_dir(minecraft_dir: &Path, version: &str) -> Option<String> {
    let versions = minecraft_dir.join("versions");
    let read = std::fs::read_dir(&versions).ok()?;
    for entry in read.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.contains("forge") && name.contains(version) {
            return Some(name);
        }
    }
    None
}

/// Mescla/atualiza o `launcher_profiles.json`, definindo o perfil Forge como
/// selecionado, SEM sobrescrever perfis existentes do usuário. Faz backup antes.
fn upsert_launcher_profile(minecraft_dir: &Path, profile_id: &str) -> Result<(), String> {
    let path = minecraft_dir.join("launcher_profiles.json");

    // Carrega o JSON existente (ou cria um objeto vazio).
    let mut root: serde_json::Value = if path.is_file() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Falha ao ler launcher_profiles.json: {e}"))?;
        // Backup antes de alterar.
        let backup = minecraft_dir.join("launcher_profiles.json.nexus-bak");
        let _ = std::fs::write(&backup, &raw);
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        std::fs::create_dir_all(minecraft_dir)
            .map_err(|e| format!("Falha ao criar pasta .minecraft: {e}"))?;
        serde_json::json!({})
    };

    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();

    // Garante o mapa "profiles".
    let profiles = obj
        .entry("profiles".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !profiles.is_object() {
        *profiles = serde_json::json!({});
    }
    let profiles_obj = profiles.as_object_mut().unwrap();

    // Adiciona/atualiza APENAS o perfil Nexus Forge (não toca nos outros).
    let now = "1970-01-01T00:00:00.000Z";
    let entry = profiles_obj
        .entry(profile_id.to_string())
        .or_insert_with(|| {
            serde_json::json!({
                "type": "custom",
                "name": "Nexus Forge 1.20.1",
                "created": now,
                "lastUsed": now,
            })
        });
    if let Some(e) = entry.as_object_mut() {
        e.insert(
            "lastVersionId".to_string(),
            serde_json::Value::String(profile_id.to_string()),
        );
        if !e.contains_key("name") {
            e.insert(
                "name".to_string(),
                serde_json::Value::String("Nexus Forge 1.20.1".to_string()),
            );
        }
        if !e.contains_key("type") {
            e.insert(
                "type".to_string(),
                serde_json::Value::String("custom".to_string()),
            );
        }
    }

    // Marca como selecionado (chaves usadas por diferentes versões do launcher).
    obj.insert(
        "selectedProfile".to_string(),
        serde_json::Value::String(profile_id.to_string()),
    );
    obj.insert(
        "lastVersionId".to_string(),
        serde_json::Value::String(profile_id.to_string()),
    );

    let out = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Falha ao serializar launcher_profiles.json: {e}"))?;
    std::fs::write(&path, out)
        .map_err(|e| format!("Falha ao gravar launcher_profiles.json: {e}"))?;
    Ok(())
}

/// Garante que o Forge <version> está instalado. Idempotente.
#[tauri::command]
pub async fn ensure_forge(version: String) -> Result<LoaderStatus, String> {
    let version = if version.trim().is_empty() {
        "1.20.1".to_string()
    } else {
        version.trim().to_string()
    };

    let minecraft_dir = minecraft_root_dir()
        .ok_or_else(|| "Não foi possível resolver a pasta .minecraft neste SO.".to_string())?;

    // 1) Já instalado? -> garante perfil e retorna.
    if let Some(profile) = find_forge_version_dir(&minecraft_dir, &version) {
        let _ = upsert_launcher_profile(&minecraft_dir, &profile);
        return Ok(LoaderStatus {
            installed: true,
            profile,
            java_present: java_present(),
            message: format!("Forge {version} já instalado."),
        });
    }

    // 2) Java presente? (Forge 1.20.1 roda em Java 21; BlueMap exige Java 21)
    if !java_present() {
        return Ok(LoaderStatus {
            installed: false,
            profile: String::new(),
            java_present: false,
            message:
                "Java não encontrado. Instale o Java 21+ (Adoptium/Temurin) e tente de novo."
                    .to_string(),
        });
    }
    let java = which_java().unwrap_or_else(|| "java".to_string());

    // 3) Baixa o forge-installer.jar oficial (padrão reqwest do download.rs).
    let installer_url = forge_installer_url();
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {e}"))?;
    let resp = client
        .get(&installer_url)
        .header("User-Agent", "LauncherMC/1.0 (Tauri)")
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar o Forge Installer: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {} ao baixar o Forge Installer.",
            resp.status()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Falha ao ler o Forge Installer: {e}"))?;

    let tmp_dir = std::env::temp_dir();
    let installer_path = tmp_dir.join(format!("forge-installer-{}.jar", FORGE_VERSION));
    std::fs::write(&installer_path, &bytes)
        .map_err(|e| format!("Falha ao gravar o Forge Installer: {e}"))?;

    // 4) Roda o installer em modo client (headless, sem GUI). Passamos
    //    `--installClient` para que ele crie a pasta
    //    versions/1.20.1-forge-47.4.21 + o perfil no launcher_profiles.json
    //    de forma não-interativa. O installer já sabe a versão a partir do
    //    próprio nome ("forge-1.20.1-47.4.21-installer.jar"); NÃO passamos
    //    `-downloadMinecraft` (o launcher baixa o jogo sob demanda).
    let output = std::process::Command::new(&java)
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .output()
        .map_err(|e| format!("Falha ao executar o Forge Installer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Forge Installer falhou: {}",
            stderr.trim()
        ));
    }

    // 5) Descobre a pasta criada em versions/ e cria/mescla o perfil.
    let profile = find_forge_version_dir(&minecraft_dir, &version).ok_or_else(|| {
        "Instalação concluída mas o perfil Forge não foi encontrado em versions/.".to_string()
    })?;
    upsert_launcher_profile(&minecraft_dir, &profile)?;

    Ok(LoaderStatus {
        installed: true,
        profile,
        java_present: true,
        message: format!("Forge {version} pronto."),
    })
}

/// Localiza o executável do Minecraft Launcher (Windows).
#[cfg(target_os = "windows")]
fn find_minecraft_launcher() -> Option<PathBuf> {
    let candidates = [
        "C:/Program Files (x86)/Minecraft Launcher/MinecraftLauncher.exe",
        "C:/Program Files/Minecraft Launcher/MinecraftLauncher.exe",
        "C:/XboxGames/Minecraft Launcher/Content/Minecraft.exe",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Some(p);
        }
    }
    // `where MinecraftLauncher.exe`
    if let Ok(out) = std::process::Command::new("where")
        .arg("MinecraftLauncher.exe")
        .output()
    {
        if out.status.success() {
            if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                let p = PathBuf::from(line.trim());
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Marca o perfil como selecionado e abre o Minecraft Launcher (não bloqueia).
#[tauri::command]
pub async fn launch_minecraft(profile: String) -> Result<String, String> {
    let minecraft_dir = minecraft_root_dir()
        .ok_or_else(|| "Não foi possível resolver a pasta .minecraft neste SO.".to_string())?;

    // Garante que o perfil recebido está selecionado no launcher_profiles.json.
    if !profile.trim().is_empty() {
        let _ = upsert_launcher_profile(&minecraft_dir, profile.trim());
    }

    #[cfg(target_os = "windows")]
    {
        let exe = find_minecraft_launcher()
            .ok_or_else(|| "Minecraft Launcher não instalado.".to_string())?;
        std::process::Command::new(&exe)
            .spawn()
            .map_err(|e| format!("Falha ao abrir o Minecraft Launcher: {e}"))?;
        return Ok("launched".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // Tenta abrir /Applications/Minecraft.app; fallback para -a Minecraft.
        let app_path = "/Applications/Minecraft.app";
        let spawn = if Path::new(app_path).exists() {
            std::process::Command::new("open").arg("-n").arg(app_path).spawn()
        } else {
            std::process::Command::new("open").arg("-a").arg("Minecraft").spawn()
        };
        spawn.map_err(|e| format!("Falha ao abrir o Minecraft: {e}. Instale o Minecraft Launcher."))?;
        return Ok("launched".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        // Ambiente de dev/container: não há Minecraft Launcher.
        let _ = &minecraft_dir;
        Err("Launch não suportado no Linux (ambiente de desenvolvimento).".to_string())
    }
}
