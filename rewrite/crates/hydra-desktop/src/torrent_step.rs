//! download-settings-modal.tsx's torrent step: the files of a magnet on
//! TorBox or Real-Debrid (getDebridFiles) as a folder tree to pick from,
//! with search, the name/size sort, select all and the selected size.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use hydra_core::repacks::Downloader;
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

use crate::{AppWindow, SelectOption, TorrentRow, TorrentStep, shell};

/// TorrentFile
#[derive(Clone, Debug, PartialEq)]
pub struct File {
    pub index: i64,
    pub path: String,
    pub length: u64,
}

/// TorrentFolderNode (index 0 is the root).
#[derive(Clone, Debug, Default)]
struct Folder {
    name: String,
    children: Vec<usize>,
    direct: Vec<i64>,
    all: Vec<i64>,
    total: u64,
}

/// buildTorrentTreeData
#[derive(Clone, Debug, Default)]
pub struct Tree {
    folders: Vec<Folder>,
    names: HashMap<i64, String>,
    files: HashMap<i64, File>,
}

impl Tree {
    pub fn build(files: &[File]) -> Tree {
        let mut tree = Tree {
            folders: vec![Folder::default()],
            names: HashMap::new(),
            files: files.iter().map(|f| (f.index, f.clone())).collect(),
        };
        let mut by_path: HashMap<String, usize> = HashMap::new();
        for file in files {
            let normalized = file.path.replace('\\', "/");
            let parts: Vec<&str> = normalized.split('/').filter(|p| !p.is_empty()).collect();
            let name = parts.last().map_or(file.path.clone(), |n| n.to_string());
            tree.names.insert(file.index, name);
            if parts.len() <= 1 {
                tree.folders[0].direct.push(file.index);
                continue;
            }
            let mut parent = 0;
            let mut path = String::new();
            for segment in &parts[..parts.len() - 1] {
                if !path.is_empty() {
                    path.push('/');
                }
                path.push_str(segment);
                let id = match by_path.get(&path) {
                    Some(id) => *id,
                    None => {
                        let id = tree.folders.len();
                        tree.folders.push(Folder {
                            name: segment.to_string(),
                            ..Folder::default()
                        });
                        tree.folders[parent].children.push(id);
                        by_path.insert(path.clone(), id);
                        id
                    }
                };
                parent = id;
            }
            tree.folders[parent].direct.push(file.index);
        }
        tree.compute(0);
        tree
    }

    /// computeTorrentFolderInfo
    fn compute(&mut self, id: usize) -> Vec<i64> {
        let children = self.folders[id].children.clone();
        let mut all = self.folders[id].direct.clone();
        for child in children {
            all.extend(self.compute(child));
        }
        self.folders[id].total = all
            .iter()
            .map(|i| self.files.get(i).map_or(0, |f| f.length))
            .sum();
        self.folders[id].all = all.clone();
        all
    }

    pub fn root_folders(&self) -> Vec<usize> {
        self.folders
            .first()
            .map(|root| root.children.clone())
            .unwrap_or_default()
    }

    pub fn folder_files(&self, id: usize) -> &[i64] {
        self.folders.get(id).map_or(&[], |f| &f.all)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sort {
    Name,
    Size,
}

/// TorrentTreeRow
#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    Folder {
        id: usize,
        depth: usize,
        name: String,
        total: u64,
        selected: usize,
        count: usize,
        expanded: bool,
    },
    File {
        index: i64,
        depth: usize,
        name: String,
        length: u64,
        selected: bool,
    },
}

/// `localeCompare` close enough for file names: case-insensitive first.
fn compare_names(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then(a.cmp(b))
}

/// filteredTorrentRows: the visible rows (search expands every folder).
pub fn rows(
    tree: &Tree,
    selected: &HashSet<i64>,
    expanded: &HashSet<usize>,
    search: &str,
    sort: Sort,
) -> Vec<Row> {
    if tree.folders.is_empty() {
        return Vec::new();
    }
    let query = search.trim().to_lowercase();
    let matching = tree
        .files
        .values()
        .filter(|f| query.is_empty() || f.path.to_lowercase().contains(&query))
        .map(|f| f.index)
        .collect();
    let mut walk = Walk {
        tree,
        selected,
        expanded,
        query,
        sort,
        matching,
        memo: HashMap::new(),
        out: Vec::new(),
    };
    let mut roots = tree.folders[0].children.clone();
    roots.sort_by(|a, b| walk.compare_folders(*a, *b));
    for root in roots {
        walk.folder(root, 0);
    }
    let mut files = walk.visible_files(0);
    files.sort_by(|a, b| walk.compare_files(*a, *b));
    for index in files {
        walk.file(index, 0);
    }
    walk.out
}

struct Walk<'a> {
    tree: &'a Tree,
    selected: &'a HashSet<i64>,
    expanded: &'a HashSet<usize>,
    query: String,
    sort: Sort,
    matching: HashSet<i64>,
    memo: HashMap<usize, bool>,
    out: Vec<Row>,
}

impl Walk<'_> {
    /// hasMatchingContent
    fn has_match(&mut self, id: usize) -> bool {
        if self.query.is_empty() {
            return true;
        }
        if let Some(found) = self.memo.get(&id) {
            return *found;
        }
        let folder = &self.tree.folders[id];
        let mut found = folder.name.to_lowercase().contains(&self.query)
            || folder.direct.iter().any(|i| self.matching.contains(i));
        if !found {
            for child in folder.children.clone() {
                if self.has_match(child) {
                    found = true;
                    break;
                }
            }
        }
        self.memo.insert(id, found);
        found
    }

    fn compare_files(&self, a: i64, b: i64) -> std::cmp::Ordering {
        match self.sort {
            Sort::Name => compare_names(
                self.tree.names.get(&a).map_or("", String::as_str),
                self.tree.names.get(&b).map_or("", String::as_str),
            ),
            Sort::Size => {
                let size = |i: i64| self.tree.files.get(&i).map_or(0, |f| f.length);
                size(a).cmp(&size(b))
            }
        }
    }

    fn compare_folders(&self, a: usize, b: usize) -> std::cmp::Ordering {
        let folders = &self.tree.folders;
        match self.sort {
            Sort::Name => compare_names(&folders[a].name, &folders[b].name),
            Sort::Size => folders[a].total.cmp(&folders[b].total),
        }
    }

    fn visible_files(&self, id: usize) -> Vec<i64> {
        self.tree.folders[id]
            .direct
            .iter()
            .copied()
            .filter(|i| self.query.is_empty() || self.matching.contains(i))
            .collect()
    }

    fn file(&mut self, index: i64, depth: usize) {
        let Some(file) = self.tree.files.get(&index) else {
            return;
        };
        self.out.push(Row::File {
            index,
            depth,
            name: self
                .tree
                .names
                .get(&index)
                .cloned()
                .unwrap_or(file.path.clone()),
            length: file.length,
            selected: self.selected.contains(&index),
        });
    }

    /// addFolderRows: the folder, its sorted child folders, its sorted files.
    fn folder(&mut self, id: usize, depth: usize) {
        if !self.has_match(id) {
            return;
        }
        let tree = self.tree;
        let folder = &tree.folders[id];
        let selected = folder
            .all
            .iter()
            .filter(|i| self.selected.contains(i))
            .count();
        let open = !self.query.is_empty() || self.expanded.contains(&id);
        self.out.push(Row::Folder {
            id,
            depth,
            name: folder.name.clone(),
            total: folder.total,
            selected,
            count: folder.all.len(),
            expanded: open,
        });
        if !open {
            return;
        }
        let mut children = folder.children.clone();
        children.sort_by(|a, b| self.compare_folders(*a, *b));
        for child in children {
            self.folder(child, depth + 1);
        }
        let mut files = self.visible_files(id);
        files.sort_by(|a, b| self.compare_files(*a, *b));
        for index in files {
            self.file(index, depth + 1);
        }
    }
}

// ---- the step's state and UI

struct State {
    ui: slint::Weak<AppWindow>,
    /// `${downloader}:${magnet}` of the open step.
    key: String,
    files: Vec<File>,
    tree: Tree,
    selected: HashSet<i64>,
    expanded: HashSet<usize>,
    search: String,
    sort: Sort,
    loading: bool,
    error: Option<String>,
    request: u64,
    /// Free space and the repack size for the space check.
    free_space: Option<u64>,
}

type Loaded = Box<dyn FnOnce(bool)>;

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    /// The settings modal's callback for the request in flight.
    static ON_LOADED: RefCell<Option<(u64, Loaded)>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            key: String::new(),
            files: Vec::new(),
            tree: Tree::default(),
            selected: HashSet::new(),
            expanded: HashSet::new(),
            search: String::new(),
            sort: Sort::Name,
            loading: false,
            error: None,
            request: 0,
            free_space: None,
        })
    });
    let t = ui.global::<TorrentStep>();
    t.set_sort_options(ModelRc::new(VecModel::from(vec![
        SelectOption {
            value: "name_asc".into(),
            label: shell::tr("game_details.torrent_name_column").into(),
        },
        SelectOption {
            value: "size_asc".into(),
            label: shell::tr("game_details.torrent_size_column").into(),
        },
    ])));
    t.on_search_edited(|text| {
        with(|s| s.search = text.to_string());
        apply();
    });
    t.on_toggle(|folder, key| {
        with(|s| {
            if folder {
                // toggleTorrentFolder: all selected -> none, else all
                let files = s.tree.folder_files(key as usize).to_vec();
                if files.is_empty() {
                    return;
                }
                let deselect = files.iter().all(|i| s.selected.contains(i));
                for index in files {
                    if deselect {
                        s.selected.remove(&index);
                    } else {
                        s.selected.insert(index);
                    }
                }
            } else {
                let index = key as i64;
                if !s.selected.remove(&index) {
                    s.selected.insert(index);
                }
            }
        });
        apply();
    });
    t.on_expand(|key| {
        with(|s| {
            let id = key as usize;
            if !s.expanded.remove(&id) {
                s.expanded.insert(id);
            }
        });
        apply();
    });
    t.on_toggle_all(|| {
        with(|s| {
            if !s.files.is_empty() && s.selected.len() == s.files.len() {
                s.selected.clear();
            } else {
                s.selected = s.files.iter().map(|f| f.index).collect();
            }
        });
        apply();
    });
    t.on_retry(|| {
        if let Some((downloader, magnet)) = current_target() {
            fetch(downloader, magnet, None);
        }
    });
    t.on_download(crate::download_settings::start_with_files);
}

/// The sort select (SelectPopup owner "torrent-sort").
pub fn set_sort(value: &str) {
    with(|s| {
        s.sort = if value == "size_asc" {
            Sort::Size
        } else {
            Sort::Name
        }
    });
    apply();
}

fn current_target() -> Option<(Downloader, String)> {
    let key = with(|s| s.key.clone())?;
    let (downloader, magnet) = key.split_once(':')?;
    Some((
        Downloader::from_i64(downloader.parse().ok()?)?,
        magnet.to_string(),
    ))
}

/// resetTorrentStepState
pub fn reset() {
    with(|s| {
        s.request += 1;
        s.files.clear();
        s.tree = Tree::default();
        s.selected.clear();
        s.expanded.clear();
        s.error = None;
        s.loading = false;
        s.search.clear();
    });
    if let Some(ui) = with(|s| s.ui.upgrade()).flatten() {
        let t = ui.global::<TorrentStep>();
        t.set_open(false);
        t.set_search(SharedString::default());
    }
    apply();
}

pub fn is_loading() -> bool {
    with(|s| s.loading).unwrap_or(false)
}

/// The selection the step would download: (sorted file indices, their size).
pub fn selection() -> Option<(Vec<i64>, u64)> {
    with(|s| {
        let mut indices: Vec<i64> = s.selected.iter().copied().collect();
        indices.sort_unstable();
        let size = s
            .files
            .iter()
            .filter(|f| s.selected.contains(&f.index))
            .map(|f| f.length)
            .sum();
        (indices, size)
    })
}

pub fn set_free_space(free: Option<u64>) {
    with(|s| s.free_space = free);
    apply();
}

/// fetchTorrentFiles, then (handleOpenTorrentStep) the single-archive notice
/// or the step. `on_loaded(single_archive)` reports back to the settings.
pub fn fetch(downloader: Downloader, magnet: String, on_loaded: Option<Loaded>) {
    let Some(request) = with(|s| {
        s.request += 1;
        s.key = format!("{}:{magnet}", downloader as i64);
        s.loading = true;
        s.error = None;
        s.request
    }) else {
        return;
    };
    if let Some(on_loaded) = on_loaded {
        ON_LOADED.with(|o| *o.borrow_mut() = Some((request, on_loaded)));
    }
    apply();
    crate::download_settings::refresh();
    crate::downloads::debrid_files(magnet, downloader, move |result| {
        let current = with(|s| s.request == request).unwrap_or(false);
        if !current {
            return;
        }
        let mut single_archive = false;
        with(|s| {
            s.loading = false;
            match &result {
                Ok(files) => {
                    s.files = files
                        .files
                        .iter()
                        .map(|f| File {
                            index: f.index,
                            path: f.path.clone(),
                            length: f.size,
                        })
                        .collect();
                    s.tree = Tree::build(&s.files);
                    s.selected = s.files.iter().map(|f| f.index).collect();
                    // Root folders start expanded.
                    s.expanded = s.tree.root_folders().into_iter().collect();
                    s.error = None;
                    let lower = files.files.first().map(|f| f.path.to_lowercase());
                    single_archive = downloader != Downloader::Torrent
                        && (files.archive_only
                            || (files.files.len() == 1
                                && lower.as_deref().is_some_and(|p| {
                                    [".zip", ".rar", ".7z"].iter().any(|e| p.ends_with(e))
                                })));
                }
                Err(error) => {
                    s.files.clear();
                    s.tree = Tree::default();
                    s.selected.clear();
                    s.expanded.clear();
                    let key = if error.starts_with("download_error_") {
                        error.clone()
                    } else {
                        "download_error_torrent_files_unavailable".to_string()
                    };
                    s.error = Some(key);
                }
            }
        });
        let failed = result.is_err();
        let on_loaded = ON_LOADED
            .with(|o| o.borrow_mut().take())
            .filter(|(r, _)| *r == request);
        if let Some((_, on_loaded)) = on_loaded {
            on_loaded(single_archive);
        }
        if let Some(ui) = with(|s| s.ui.upgrade()).flatten() {
            let open = !single_archive || failed;
            let t = ui.global::<TorrentStep>();
            if open && !t.get_open() {
                crate::download_settings::snapshot_backdrop(|ui, img| {
                    ui.global::<TorrentStep>().set_backdrop(img)
                });
            }
            t.set_open(open);
        }
        apply();
        crate::download_settings::refresh();
    });
}

pub fn apply() {
    let Some((ui, rows, all_selected, has_files, selected_size, summary, loading, error, sort)) =
        with(|s| {
            let ui = s.ui.upgrade()?;
            let rows = rows(&s.tree, &s.selected, &s.expanded, &s.search, s.sort);
            let selected_size: u64 = s
                .files
                .iter()
                .filter(|f| s.selected.contains(&f.index))
                .map(|f| f.length)
                .sum();
            Some((
                ui,
                rows,
                !s.files.is_empty() && s.selected.len() == s.files.len(),
                !s.files.is_empty(),
                selected_size,
                format!(
                    "{}: {}/{}",
                    shell::tr("game_details.selected_files"),
                    s.selected.len(),
                    s.files.len()
                ),
                s.loading,
                s.error.clone(),
                s.sort,
            ))
        })
        .flatten()
    else {
        return;
    };
    let t = ui.global::<TorrentStep>();
    let size = |bytes: u64| crate::library_page::format_bytes(bytes as f64);
    let rows: Vec<TorrentRow> = rows
        .into_iter()
        .map(|row| match row {
            Row::Folder {
                id,
                depth,
                name,
                total,
                selected,
                count,
                expanded,
            } => TorrentRow {
                folder: true,
                key: id as i32,
                depth: depth as i32,
                name: name.into(),
                size: size(total).into(),
                checked: count > 0 && selected == count,
                indeterminate: selected > 0 && selected < count,
                expanded,
            },
            Row::File {
                index,
                depth,
                name,
                length,
                selected,
            } => TorrentRow {
                folder: false,
                key: index as i32,
                depth: depth as i32,
                name: name.into(),
                size: size(length).into(),
                checked: selected,
                indeterminate: false,
                expanded: false,
            },
        })
        .collect();
    let current = t.get_rows();
    match current.as_any().downcast_ref::<VecModel<TorrentRow>>() {
        Some(model) if model.row_count() == rows.len() => {
            for (i, row) in rows.into_iter().enumerate() {
                if model.row_data(i).as_ref() != Some(&row) {
                    model.set_row_data(i, row);
                }
            }
        }
        _ => t.set_rows(ModelRc::new(VecModel::from(rows))),
    }
    t.set_all_selected(all_selected);
    t.set_has_files(has_files);
    t.set_selected_size(size(selected_size).into());
    t.set_summary(summary.into());
    t.set_loading(loading);
    t.set_error(
        error
            .as_ref()
            .map(|e| shell::tr(&format!("game_details.{e}")))
            .unwrap_or_default()
            .into(),
    );
    let (value, label) = match sort {
        Sort::Size => ("size_asc", shell::tr("game_details.torrent_size_column")),
        Sort::Name => ("name_asc", shell::tr("game_details.torrent_name_column")),
    };
    t.set_sort_value(value.into());
    t.set_sort_label(label.into());
    // hasEnoughDiskSpace with the selection's size
    let free = with(|s| s.free_space).flatten();
    let enough = free.is_none_or(|free| {
        selected_size == 0
            || free >= selected_size + hydra_core::repacks::MINIMUM_FREE_DISK_SPACE_BYTES
    });
    t.set_space_error(
        if enough {
            String::new()
        } else {
            shell::tr_with(
                "game_details.not_enough_space_on_disk",
                &[
                    ("required", size(selected_size).into()),
                    ("available", size(free.unwrap_or(0)).into()),
                ],
            )
        }
        .into(),
    );
    let starting = ui.global::<crate::DownloadSettings>().get_starting();
    t.set_can_download(!starting && !loading && error.is_none() && enough && has_selection());
}

fn has_selection() -> bool {
    with(|s| !s.selected.is_empty()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> Vec<File> {
        vec![
            File {
                index: 0,
                path: "Game/setup.exe".into(),
                length: 10,
            },
            File {
                index: 1,
                path: "Game/data/b.bin".into(),
                length: 30,
            },
            File {
                index: 2,
                path: "Game/data/a.bin".into(),
                length: 20,
            },
            File {
                index: 3,
                path: "readme.txt".into(),
                length: 1,
            },
        ]
    }

    fn names(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .map(|r| match r {
                Row::Folder { name, depth, .. } => format!("{depth}:{name}/"),
                Row::File { name, depth, .. } => format!("{depth}:{name}"),
            })
            .collect()
    }

    #[test]
    fn builds_sorted_rows() {
        let tree = Tree::build(&files());
        let all: HashSet<i64> = [0, 1, 2, 3].into();
        let expanded: HashSet<usize> = (0..tree.folders.len()).collect();
        let rows = rows(&tree, &all, &expanded, "", Sort::Name);
        assert_eq!(
            names(&rows),
            [
                "0:Game/",
                "1:data/",
                "2:a.bin",
                "2:b.bin",
                "1:setup.exe",
                "0:readme.txt"
            ]
        );
        let Row::Folder { total, count, .. } = &rows[0] else {
            panic!()
        };
        assert_eq!((*total, *count), (60, 3));
        let by_size = super::rows(&tree, &all, &expanded, "", Sort::Size);
        assert_eq!(names(&by_size)[2..4], ["2:a.bin", "2:b.bin"]);
    }

    #[test]
    fn collapsed_folders_and_search() {
        let tree = Tree::build(&files());
        let none = HashSet::new();
        let collapsed = rows(&tree, &none, &HashSet::new(), "", Sort::Name);
        assert_eq!(names(&collapsed), ["0:Game/", "0:readme.txt"]);
        // A search opens every folder and keeps only matching branches.
        let found = rows(&tree, &none, &HashSet::new(), "B.BIN", Sort::Name);
        assert_eq!(names(&found), ["0:Game/", "1:data/", "2:b.bin"]);
    }

    #[test]
    fn partial_selection_counts() {
        let tree = Tree::build(&files());
        let some: HashSet<i64> = [1].into();
        let rows = rows(&tree, &some, &HashSet::new(), "", Sort::Name);
        let Row::Folder {
            selected, count, ..
        } = &rows[0]
        else {
            panic!()
        };
        assert_eq!((*selected, *count), (1, 3));
    }
}
