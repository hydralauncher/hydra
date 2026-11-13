//! Headless checks of the leaderboards page (Slint testing backend, mock
//! time): a ready board's rows, "Load more" and the sidebar react to clicks.

use std::cell::RefCell;
use std::rc::Rc;

use slint::platform::{PointerEventButton, WindowEvent};
use slint::{ComponentHandle, LogicalPosition, ModelRc, VecModel};

include!(concat!(env!("OUT_DIR"), "/leaderboards_harness.rs"));

fn wait(ms: u64) {
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(ms));
}

/// The testing backend never renders, so a pointer move visits the item tree
/// and instantiates the `if`-mounted parts.
fn settle(ui: &LeaderboardsHarness) {
    for _ in 0..10 {
        ui.window().dispatch_event(WindowEvent::PointerMoved {
            position: LogicalPosition::new(1., 1.),
        });
        wait(16);
    }
}

fn click(ui: &LeaderboardsHarness, x: f32, y: f32) {
    let position = LogicalPosition::new(x, y);
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position });
    ui.window().dispatch_event(WindowEvent::PointerPressed {
        position,
        button: PointerEventButton::Left,
    });
    ui.window().dispatch_event(WindowEvent::PointerReleased {
        position,
        button: PointerEventButton::Left,
    });
    wait(16);
}

fn row(rank: i32, id: &str) -> LbRow {
    LbRow {
        user_id: id.into(),
        rank,
        tier: if rank <= 10 { "top10" } else { "default" }.into(),
        name: id.to_uppercase().into(),
        value: format!("{} h", 100 - rank).into(),
        ..Default::default()
    }
}

fn card(rank: i32, tier: &str) -> LbPodiumCard {
    LbPodiumCard {
        user_id: format!("p{rank}").into(),
        rank,
        tier: tier.into(),
        name: format!("Player {rank}").into(),
        value: "100 h".into(),
        ..Default::default()
    }
}

/// A ready ranking without the insight. In this 1200x860 harness the board
/// is 344..1167 wide; its header ends at 173, the podium at 513 and the
/// table header at 557, so rows start at 565 (56px, 8px apart).
fn ready_board() -> LeaderboardsHarness {
    i_slint_backend_testing::init_no_event_loop();
    let ui = LeaderboardsHarness::new().unwrap();
    ui.window().set_size(slint::LogicalSize::new(1200., 860.));
    let data = ui.global::<LeaderboardsData>();
    data.set_signed_in(true);
    data.set_tab("ranking".into());
    data.set_metrics_loading(false);
    data.set_board_state("ready".into());
    data.set_board_title("Playtime".into());
    data.set_board_icon("playtime".into());
    data.set_value_column("Hours".into());
    data.set_podium(ModelRc::new(VecModel::from(vec![
        card(1, "gold"),
        card(2, "silver"),
        card(3, "bronze"),
    ])));
    data.set_rows(ModelRc::new(VecModel::from(vec![
        row(4, "u4"),
        row(5, "u5"),
    ])));
    data.set_has_more(true);
    ui.show().unwrap();
    settle(&ui);
    ui
}

#[test]
fn a_row_opens_its_player() {
    let ui = ready_board();
    let opened = Rc::new(RefCell::new(Vec::<String>::new()));
    let seen = opened.clone();
    ui.global::<LeaderboardsData>()
        .on_open_profile(move |id| seen.borrow_mut().push(id.to_string()));

    click(&ui, 700., 593.);
    click(&ui, 700., 657.);
    assert_eq!(*opened.borrow(), ["u4", "u5"]);
}

#[test]
fn load_more_and_the_stats_item_respond() {
    let ui = ready_board();
    let more = Rc::new(RefCell::new(0));
    let stats = Rc::new(RefCell::new(0));
    let (m, s) = (more.clone(), stats.clone());
    let data = ui.global::<LeaderboardsData>();
    data.on_load_more(move || *m.borrow_mut() += 1);
    data.on_open_stats(move || *s.borrow_mut() += 1);

    // "Load more" sits 20px under the last row (685), centered on the board
    click(&ui, 755., 725.);
    assert_eq!(*more.borrow(), 1, "Load more should ask for more rows");

    // "Your stats": the first sidebar item (y 121..161)
    click(&ui, 150., 141.);
    assert_eq!(*stats.borrow(), 1, "Your stats should open the stats tab");
}

#[test]
fn a_podium_card_selects_its_entry() {
    let ui = ready_board();
    let selected = Rc::new(RefCell::new(Vec::<String>::new()));
    let seen = selected.clone();
    ui.global::<LeaderboardsData>()
        .on_select_entry(move |id| seen.borrow_mut().push(id.to_string()));

    // the gold card (344.. about 551) and the bronze one (on the right)
    click(&ui, 450., 400.);
    click(&ui, 1100., 450.);
    assert_eq!(*selected.borrow(), ["p1", "p3"]);
}
