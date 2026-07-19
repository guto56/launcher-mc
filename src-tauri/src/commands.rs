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
