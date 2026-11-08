//! Prints the sidebar order of a library, for comparing with Electron.
//! `cargo run -p hydra-core --example library_dump -- <electron userData> [sort]`

use hydra_core::library::{self, Collection, SortBy};
use hydra_db::import;

fn main() {
    let mut args = std::env::args().skip(1);
    let electron = std::path::PathBuf::from(args.next().expect("electron userData folder"));
    let sort = SortBy::parse(&args.next().unwrap_or_else(|| "title_asc".into()));
    let native = std::env::temp_dir().join(format!("hydra-library-dump-{}", std::process::id()));
    let (db, origin) = import::open_or_import(&native, Some(&electron), "hydra-db").expect("open");
    eprintln!("origin: {origin:?}");
    let started = std::time::Instant::now();
    let games = library::load_library(&db, Collection::Visible, None).expect("library");
    let mut groups = library::group_library_games(&games, &[]);
    library::sort_games(&mut groups, sort);
    // Sidebar default: favorites first.
    let (favorites, rest): (Vec<_>, Vec<_>) = groups.into_iter().partition(|g| g.game.flag("favorite"));
    let ordered: Vec<_> = favorites.into_iter().chain(rest).collect();
    eprintln!("{} games, {} rows in {:?}", games.len(), ordered.len(), started.elapsed());
    for group in ordered.iter().take(15) {
        println!("{}", group.game.title());
    }
    drop(db);
    let _ = std::fs::remove_dir_all(&native);
}
