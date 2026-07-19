//! Download seletivo de um mod via rota /api/mods/file/:filename do painel.
//!
//! O launcher chama `download_mod(filename)` e recebe os bytes do jar, que então
//! são gravados localmente via `save_mod`. Assim o binário baixa APENAS os mods
//! que faltam/estão desatualizados (economia de banda vs. baixar o zip inteiro).

#[tauri::command]
pub async fn download_mod(
    app: tauri::AppHandle,
    filename: String,
) -> Result<Vec<u8>, String> {
    // Sanitiza: mantém só o nome do arquivo (sem path).
    let safe = std::path::Path::new(&filename)
        .file_name()
        .ok_or_else(|| "Nome de arquivo inválido.".to_string())?
        .to_string_lossy()
        .to_string();

    let base = std::env::var("LAUNCHER_API_BASE")
        .unwrap_or_else(|_| "https://painel-mc.centralchamados.xyz".to_string());
    let url = format!("{}/api/mods/file/{}", base.trim_end_matches('/'), safe);

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("User-Agent", "LauncherMC/1.0 (Tauri)")
        .send()
        .await
        .map_err(|e| format!("Falha ao conectar no painel: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let msg = resp
            .text()
            .await
            .unwrap_or_else(|_| "erro desconhecido".to_string());
        return Err(format!("HTTP {status} ao baixar {safe}: {msg}"));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let _ = app; // mantém assinatura compatível com invoke
    Ok(bytes.to_vec())
}
