mod commands;
mod download;

use commands::*;
use crate::download::download_mod;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detect_mods_dir,
            list_local_mods,
            save_mod,
            open_minecraft_folder,
            download_mod,
            base_url,
            server_mods,
            server_status,
            ensure_fabric,
            launch_minecraft,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao rodar o Launcher MC Silicon");
}
