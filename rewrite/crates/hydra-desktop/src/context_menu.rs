//! components/context-menu: shows a menu at the pointer and routes clicks
//! to whoever opened it. `closeOnClick` (default true) closes it after the
//! handler runs.

use std::cell::RefCell;
use std::rc::Rc;

use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, ContextMenu, MenuEntry, MenuLeaf, Popup};

#[derive(Clone, Default)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub icon: &'static str,
    pub disabled: bool,
    pub danger: bool,
    pub separator: bool,
    pub keep_open: bool,
    pub children: Vec<Item>,
}

impl Item {
    pub fn new(id: impl Into<String>, label: impl Into<String>, icon: &'static str) -> Self {
        Item {
            id: id.into(),
            label: label.into(),
            icon,
            ..Default::default()
        }
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
    pub fn separator(mut self, separator: bool) -> Self {
        self.separator = separator;
        self
    }
    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }
    pub fn submenu(mut self, children: Vec<Item>) -> Self {
        self.children = children;
        self
    }
}

type Handler = Rc<dyn Fn(&str)>;
pub type Secondary = Rc<dyn Fn(&str, f32, f32)>;

struct State {
    ui: slint::Weak<AppWindow>,
    items: Vec<Item>,
    handler: Option<Handler>,
    secondary: Option<Secondary>,
    generation: i32,
    /// `.context-menu--game-not-installed`: no border above danger rows in submenus.
    plain_danger: bool,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            items: Vec::new(),
            handler: None,
            secondary: None,
            generation: 0,
            plain_danger: false,
        })
    });
    let menu = ui.global::<ContextMenu>();
    menu.on_activated(|id| activated(&id));
    menu.on_item_context_menu(|id, x, y| {
        let secondary = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.secondary.clone()));
        if let Some(secondary) = secondary {
            secondary(&id, x, y);
        }
    });
    ui.global::<crate::SecondaryMenu>()
        .on_activated(|id| secondary_activated(&id));
}

fn leaf(item: &Item, danger_border: bool) -> MenuLeaf {
    MenuLeaf {
        id: item.id.clone().into(),
        label: item.label.clone().into(),
        icon: item.icon.into(),
        disabled: item.disabled,
        danger: item.danger,
        danger_border,
        separator: item.separator,
    }
}

fn entries(items: &[Item], plain_danger: bool) -> Vec<MenuEntry> {
    items
        .iter()
        .map(|item| MenuEntry {
            id: item.id.clone().into(),
            label: item.label.clone().into(),
            icon: item.icon.into(),
            disabled: item.disabled,
            danger: item.danger,
            danger_border: item.danger,
            separator: item.separator,
            children: ModelRc::new(VecModel::from(
                item.children
                    .iter()
                    .map(|c| leaf(c, c.danger && !plain_danger))
                    .collect::<Vec<_>>(),
            )),
        })
        .collect()
}

/// Open a menu at `(x, y)` (window coordinates).
pub fn show(
    x: f32,
    y: f32,
    items: Vec<Item>,
    plain_danger: bool,
    handler: impl Fn(&str) + 'static,
    secondary: Option<Secondary>,
) {
    let Some((ui, generation)) = STATE.with(|s| {
        let mut s = s.borrow_mut();
        let s = s.as_mut()?;
        s.items = items.clone();
        s.handler = Some(Rc::new(handler));
        s.secondary = secondary;
        s.generation += 1;
        s.plain_danger = plain_danger;
        s.ui.upgrade().map(|ui| (ui, s.generation))
    }) else {
        return;
    };
    let menu = ui.global::<ContextMenu>();
    menu.set_items(ModelRc::new(VecModel::from(entries(&items, plain_danger))));
    menu.set_x(x);
    menu.set_y(y);
    menu.set_open_submenu(Default::default());
    menu.set_force_submenu(Default::default());
    menu.set_generation(generation);
    ui.global::<Popup>().set_open("context-menu".into());
}

/// Rebuild the open menu's rows (labels/icons/disabled changed).
pub fn update(items: Vec<Item>) {
    let Some((ui, plain)) = STATE.with(|s| {
        let mut s = s.borrow_mut();
        let s = s.as_mut()?;
        s.items = items.clone();
        s.ui.upgrade().map(|ui| (ui, s.plain_danger))
    }) else {
        return;
    };
    if ui.global::<Popup>().get_open() != "context-menu" {
        return;
    }
    ui.global::<ContextMenu>()
        .set_items(ModelRc::new(VecModel::from(entries(&items, plain))));
}

pub fn is_open() -> bool {
    STATE
        .with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade()))
        .is_some_and(|ui| ui.global::<Popup>().get_open() == "context-menu")
}

/// `forceOpenSubmenuId`: keep a submenu open while its modal is up ("" clears).
pub fn force_submenu(id: &str) {
    if let Some(ui) = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade())) {
        ui.global::<ContextMenu>().set_force_submenu(id.into());
        if !id.is_empty() {
            ui.global::<ContextMenu>().set_open_submenu(id.into());
        }
    }
}

pub fn close() {
    if let Some(ui) = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade()))
        && ui.global::<Popup>().get_open() == "context-menu"
    {
        crate::popup::close(&ui);
    }
}

#[derive(Default)]
struct SecondaryState {
    items: Vec<Item>,
    handler: Option<Handler>,
    on_close: Option<Rc<dyn Fn()>>,
    generation: i32,
}

thread_local! {
    static SECONDARY: RefCell<SecondaryState> = RefCell::new(SecondaryState::default());
}

/// A second menu over the first one (the collection context menu). It has
/// no submenus; an item closes it unless it is disabled. `on_close` runs
/// whenever it closes (item, outside press, scroll, Escape).
pub fn show_secondary(
    x: f32,
    y: f32,
    items: Vec<Item>,
    handler: impl Fn(&str) + 'static,
    on_close: Option<Rc<dyn Fn()>>,
) {
    let Some(ui) = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade())) else {
        return;
    };
    let generation = SECONDARY.with(|s| {
        let mut s = s.borrow_mut();
        s.items = items.clone();
        s.handler = Some(Rc::new(handler));
        s.on_close = on_close;
        s.generation += 1;
        s.generation
    });
    let menu = ui.global::<crate::SecondaryMenu>();
    menu.set_items(ModelRc::new(VecModel::from(entries(&items, false))));
    menu.set_x(x);
    menu.set_y(y);
    menu.set_generation(generation);
    menu.set_open(true);
}

/// Rebuild the open secondary menu's rows.
pub fn update_secondary(items: Vec<Item>) {
    let Some(ui) = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade())) else {
        return;
    };
    SECONDARY.with(|s| s.borrow_mut().items = items.clone());
    ui.global::<crate::SecondaryMenu>()
        .set_items(ModelRc::new(VecModel::from(entries(&items, false))));
}

pub fn secondary_open() -> bool {
    STATE
        .with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade()))
        .is_some_and(|ui| ui.global::<crate::SecondaryMenu>().get_open())
}

pub fn close_secondary() {
    let Some(ui) = STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade())) else {
        return;
    };
    let menu = ui.global::<crate::SecondaryMenu>();
    if !menu.get_open() {
        return;
    }
    menu.set_open(false);
    if let Some(on_close) = SECONDARY.with(|s| s.borrow_mut().on_close.take()) {
        on_close();
    }
}

fn secondary_activated(id: &str) {
    let Some((item, handler)) = SECONDARY.with(|s| {
        let s = s.borrow();
        Some((
            s.items.iter().find(|i| i.id == id)?.clone(),
            s.handler.clone()?,
        ))
    }) else {
        return;
    };
    if item.disabled {
        return;
    }
    // Closed first, so `on_close` sees the menu gone before the item opens
    // its modal (the first menu keeps its submenu open for that modal).
    if !item.keep_open {
        close_secondary();
    }
    handler(id);
}

fn find<'a>(items: &'a [Item], id: &str) -> Option<&'a Item> {
    items.iter().find_map(|item| {
        if item.id == id {
            Some(item)
        } else {
            find(&item.children, id)
        }
    })
}

fn activated(id: &str) {
    let Some((item, handler)) = STATE.with(|s| {
        let s = s.borrow();
        let s = s.as_ref()?;
        Some((find(&s.items, id)?.clone(), s.handler.clone()?))
    }) else {
        return;
    };
    // A submenu row only toggles its submenu (handleItemClick returns early).
    if item.disabled || !item.children.is_empty() {
        return;
    }
    handler(id);
    if !item.keep_open {
        close();
    }
}
