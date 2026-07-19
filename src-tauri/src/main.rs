// Entrypoint do binário (Tauri v2). Redireciona para a lib.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    launcher_mc_lib::run()
}
