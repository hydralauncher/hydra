//! Headless checks of the profile image crop (image-crop-modal.tsx math):
//! the fit at zoom 1, zooming around the frame's center, and what Apply sends.

use std::cell::RefCell;
use std::rc::Rc;

use i_slint_backend_testing::ElementHandle;
use slint::ComponentHandle;
use slint::platform::WindowEvent;

include!(concat!(env!("OUT_DIR"), "/profile_harness.rs"));

fn settle(ui: &ProfileHarness, ms: u64) {
    for _ in 0..(ms / 16).max(1) {
        ui.window().dispatch_event(WindowEvent::PointerMoved {
            position: slint::LogicalPosition::new(5., 5.),
        });
        i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(16));
    }
}

fn press(ui: &ProfileHarness, label: &str) {
    let button = ElementHandle::find_by_accessible_label(ui, label)
        .next()
        .unwrap_or_else(|| panic!("no element labelled {label}"));
    button.invoke_accessible_default_action();
}

#[test]
fn crop_fits_centers_and_zooms_around_the_middle() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = ProfileHarness::new().unwrap();
    ui.global::<T>().on_tr(|key| key);
    let modals = ui.global::<ProfileModals>();
    modals.set_crop_output_width(512.0);
    modals.set_crop_output_height(512.0);
    modals.set_crop_max_frame(420.0);
    modals.set_crop_natural_width(1000.0);
    modals.set_crop_natural_height(500.0);
    let applied = Rc::new(RefCell::new(Vec::new()));
    let sink = applied.clone();
    modals.on_crop_apply(move |left, top, width, height| {
        sink.borrow_mut().push((left, top, width, height));
    });
    ui.show().unwrap();
    modals.set_crop_open(true);
    settle(&ui, 500);

    // 420px frame, minScale max(420/1000, 420/500) = 0.84: the middle 500x500.
    press(&ui, "user_profile.apply_crop");
    let (left, top, width, height) = applied.borrow()[0];
    assert!((left - 250.0).abs() < 0.01, "left {left}");
    assert!(top.abs() < 0.01, "top {top}");
    assert!((width - 500.0).abs() < 0.01 && (height - 500.0).abs() < 0.01);

    // Zoom in one step (1.25x) around the frame's center.
    press(&ui, "user_profile.zoom_in");
    press(&ui, "user_profile.apply_crop");
    let (left, top, width, height) = applied.borrow()[1];
    assert!((left - 300.0).abs() < 0.01, "left {left}");
    assert!((top - 50.0).abs() < 0.01, "top {top}");
    assert!((width - 400.0).abs() < 0.01 && (height - 400.0).abs() < 0.01);

    // Zoom out twice: the second is disabled at 1x.
    press(&ui, "user_profile.zoom_out");
    press(&ui, "user_profile.zoom_out");
    press(&ui, "user_profile.apply_crop");
    let (_, _, width, _) = applied.borrow()[2];
    assert!((width - 500.0).abs() < 0.01, "width {width}");
}
