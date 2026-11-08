//! Lists the installed Steam games and their launch executables, the way
//! the installed-games scan sees them. `cargo run -p hydra-core --example steam_installed`

fn main() {
    let steam = hydra_core::steam_apps::steam_location();
    println!("Steam: {steam:?}");
    if let Some(steam) = &steam {
        let folders = hydra_core::steam_apps::library_folders(steam);
        println!("Library folders: {folders:?}");
        let apps = hydra_core::steam_apps::installed_apps(&folders);
        println!("{} installed apps", apps.len());
    }
    let games = hydra_core::steam_apps::installed_games();
    let mut executables: Vec<_> = games.executables.iter().collect();
    executables.sort();
    for (app_id, path) in executables {
        println!("{app_id}\t{path}");
    }
    println!("Unresolved: {:?}", games.unresolved_directories);
}
