//! Headless modal checks (Slint testing backend, mock time; no real window).

use slint::ComponentHandle;
use slint::platform::{Key, WindowEvent};

include!(concat!(env!("OUT_DIR"), "/game_page_harness.rs"));

fn wait(ms: u64) {
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(ms));
}

/// The testing backend never renders, so nudge the item tree (a pointer move
/// visits it) to instantiate `if`-mounted elements like the modal.
fn settle(ui: &GamePageHarness, ms: u64) {
    for _ in 0..(ms / 16).max(1) {
        ui.window().dispatch_event(WindowEvent::PointerMoved {
            position: slint::LogicalPosition::new(5., 5.),
        });
        wait(16);
    }
}

fn press_escape(ui: &GamePageHarness) {
    let text: slint::SharedString = Key::Escape.into();
    ui.window()
        .dispatch_event(WindowEvent::KeyPressed { text: text.clone() });
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text });
}

#[test]
fn escape_closes_and_reopening_keeps_focus() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = GamePageHarness::new().unwrap();
    ui.window().set_size(slint::LogicalSize::new(1440., 900.));
    ui.global::<GameData>().set_loaded(true);
    ui.show().unwrap();

    ui.invoke_open_cloud_save();
    settle(&ui, 600);
    assert!(ui.get_modal_open(), "cloud modal should be open");

    press_escape(&ui);
    wait(50);
    assert!(
        !ui.get_modal_open(),
        "Esc should start closing the cloud modal"
    );

    // Reopen another modal while the first is still playing its 400ms exit.
    settle(&ui, 100);
    ui.invoke_open_game_options();
    settle(&ui, 600); // the cloud modal's unmount fires in here
    assert!(ui.get_modal_open(), "options modal should be open");

    press_escape(&ui);
    wait(50);
    assert!(
        !ui.get_modal_open(),
        "Esc must still reach the options modal"
    );
}
