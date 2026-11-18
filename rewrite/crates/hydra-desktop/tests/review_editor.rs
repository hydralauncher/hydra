//! Headless check: clicking the review editor focuses it and typing lands in it.
//! Uses Slint's testing backend, so no real mouse or keyboard is involved.

use slint::platform::{PointerEventButton, WindowEvent};
use slint::{ComponentHandle, LogicalPosition};

include!(concat!(env!("OUT_DIR"), "/editor_harness.rs"));

fn wait(ms: u64) {
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(ms));
}

#[test]
fn click_then_type() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = Harness::new().unwrap();
    ui.show().unwrap();
    let window = ui.window();

    // Toolbar is ~41px, then 12px padding: this lands inside the text area.
    let point = LogicalPosition::new(150., 50. + 41. + 30.);
    window.dispatch_event(WindowEvent::PointerMoved { position: point });
    window.dispatch_event(WindowEvent::PointerPressed {
        position: point,
        button: PointerEventButton::Left,
    });
    wait(150); // Flickable forwards a press after 100ms
    window.dispatch_event(WindowEvent::PointerReleased {
        position: point,
        button: PointerEventButton::Left,
    });
    wait(50);
    println!("focused after click: {}", ui.get_focused());

    for ch in "hello".chars() {
        window.dispatch_event(WindowEvent::KeyPressed { text: ch.into() });
        window.dispatch_event(WindowEvent::KeyReleased { text: ch.into() });
    }
    wait(50);
    println!(
        "editor text: {:?}, keys seen by page FocusScope: {:?}",
        ui.get_typed(),
        ui.get_page_keys()
    );
    assert_eq!(ui.get_typed().as_str(), "hello");
}
